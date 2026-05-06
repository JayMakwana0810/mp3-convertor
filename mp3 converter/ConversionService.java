package io.soundrip.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ConversionService
 *
 * Responsibilities:
 *   1. Save the uploaded video to a temp directory
 *   2. Invoke FFmpeg to extract audio as MP3
 *   3. Expose the converted file for download
 *   4. Auto-delete files older than 1 hour (GDPR / privacy)
 *
 * Prerequisites:
 *   • FFmpeg must be installed and on the system PATH
 *     (or set soundrip.ffmpeg.path in application.properties)
 */
@Service
@EnableScheduling
public class ConversionService {

    private static final Logger log = LoggerFactory.getLogger(ConversionService.class);

    /** Maximum allowed upload size (500 MB) */
    private static final long MAX_SIZE = 500L * 1024 * 1024;

    /** Allowed video MIME types */
    private static final Set<String> ALLOWED_TYPES = Set.of(
            "video/mp4", "video/avi", "video/x-msvideo", "video/x-matroska",
            "video/quicktime", "video/x-ms-wmv", "video/x-flv", "video/webm"
    );

    /** Allowed file extensions (browser may send generic content-type) */
    private static final Set<String> ALLOWED_EXTS = Set.of(
            "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "m4v", "3gp"
    );

    // ── Config ────────────────────────────────────────────────────────────────

    @Value("${soundrip.temp-dir:${java.io.tmpdir}/soundrip}")
    private String tempDirPath;

    @Value("${soundrip.ffmpeg.path:ffmpeg}")
    private String ffmpegPath;

    /** jobId → absolute path of the output MP3 */
    private final Map<String, Path> jobStore = new ConcurrentHashMap<>();

    /** jobId → creation timestamp (for cleanup) */
    private final Map<String, Instant> jobCreated = new ConcurrentHashMap<>();

    // ── Init ──────────────────────────────────────────────────────────────────

    @PostConstruct
    void init() throws IOException {
        Path dir = Paths.get(tempDirPath);
        Files.createDirectories(dir);
        log.info("SoundRip temp directory: {}", dir.toAbsolutePath());
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Validate the upload, run FFmpeg, and return a jobId.
     *
     * @param file     multipart video upload
     * @param quality  bitrate kbps (128 / 192 / 320)
     * @return jobId   use with {@link #getOutput(String)} to fetch the MP3
     */
    public String convert(MultipartFile file, int quality) throws IOException, InterruptedException {

        // ── Validation ────────────────────────────────────────────────────────
        if (file.isEmpty()) {
            throw new IllegalArgumentException("Uploaded file is empty.");
        }
        if (file.getSize() > MAX_SIZE) {
            throw new IllegalArgumentException(
                    "File exceeds 500 MB limit (" + humanBytes(file.getSize()) + ").");
        }

        String ext = extension(file.getOriginalFilename());
        String ct  = file.getContentType() == null ? "" : file.getContentType();

        if (!ALLOWED_EXTS.contains(ext) && !ALLOWED_TYPES.contains(ct)) {
            throw new IllegalArgumentException(
                    "Unsupported file type: " + ct + " (." + ext + ").");
        }

        // ── Save upload ───────────────────────────────────────────────────────
        String jobId    = UUID.randomUUID().toString();
        Path   tempDir  = Paths.get(tempDirPath);
        Path   inputPath  = tempDir.resolve(jobId + "_input." + (ext.isEmpty() ? "mp4" : ext));
        Path   outputPath = tempDir.resolve(jobId + "_output.mp3");

        log.info("[{}] Saving upload to {}", jobId, inputPath);
        file.transferTo(inputPath);

        // ── Run FFmpeg ────────────────────────────────────────────────────────
        runFfmpeg(jobId, inputPath, outputPath, quality);

        // Cleanup the input video after conversion
        try { Files.deleteIfExists(inputPath); } catch (IOException ignored) {}

        // Register the job
        jobStore.put(jobId, outputPath);
        jobCreated.put(jobId, Instant.now());

        log.info("[{}] Conversion done → {}", jobId, outputPath);
        return jobId;
    }

    /**
     * Return a {@link Resource} for the converted MP3.
     *
     * @throws NoSuchElementException if the jobId is unknown or file not found
     */
    public Resource getOutput(String jobId) {
        Path path = jobStore.get(jobId);
        if (path == null) throw new NoSuchElementException("Unknown jobId: " + jobId);
        return new FileSystemResource(path);
    }

    // ── FFmpeg ────────────────────────────────────────────────────────────────

    /**
     * Builds and executes the FFmpeg command:
     *   ffmpeg -i <input> -vn -acodec libmp3lame -ab <quality>k -ar 44100 -ac 2 <output>
     *
     * @param jobId      for logging
     * @param input      source video path
     * @param output     destination MP3 path
     * @param quality    bitrate in kbps
     */
    private void runFfmpeg(String jobId, Path input, Path output, int quality)
            throws IOException, InterruptedException {

        List<String> cmd = List.of(
                ffmpegPath,
                "-y",                          // overwrite without asking
                "-i", input.toAbsolutePath().toString(),
                "-vn",                         // no video
                "-acodec", "libmp3lame",       // MP3 encoder
                "-ab", quality + "k",          // bitrate
                "-ar", "44100",                // sample rate
                "-ac", "2",                    // stereo
                output.toAbsolutePath().toString()
        );

        log.info("[{}] Running: {}", jobId, String.join(" ", cmd));

        ProcessBuilder pb = new ProcessBuilder(cmd)
                .redirectErrorStream(true);    // merge stdout + stderr

        Process process = pb.start();

        // Log FFmpeg output at DEBUG level
        try (var reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                log.debug("[{}] ffmpeg: {}", jobId, line);
            }
        }

        int exitCode = process.waitFor();
        if (exitCode != 0) {
            throw new RuntimeException(
                    "FFmpeg exited with code " + exitCode + " for jobId=" + jobId);
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    /**
     * Every 15 minutes, delete output files older than 1 hour.
     */
    @Scheduled(fixedDelay = 15 * 60 * 1000L)
    void cleanup() {
        Instant cutoff = Instant.now().minusSeconds(3600);
        Iterator<Map.Entry<String, Instant>> it = jobCreated.entrySet().iterator();

        while (it.hasNext()) {
            Map.Entry<String, Instant> entry = it.next();
            if (entry.getValue().isBefore(cutoff)) {
                String jobId = entry.getKey();
                Path   path  = jobStore.remove(jobId);
                it.remove();
                if (path != null) {
                    try {
                        Files.deleteIfExists(path);
                        log.info("[cleanup] Deleted expired file for jobId={}", jobId);
                    } catch (IOException e) {
                        log.warn("[cleanup] Failed to delete {}: {}", path, e.getMessage());
                    }
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String extension(String filename) {
        if (filename == null) return "";
        int dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.substring(dot + 1).toLowerCase() : "";
    }

    private String humanBytes(long bytes) {
        if (bytes < 1024)            return bytes + " B";
        if (bytes < 1024 * 1024)     return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.1f MB", bytes / (1024.0 * 1024));
    }
}
