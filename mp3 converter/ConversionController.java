package io.soundrip.controller;

import io.soundrip.service.ConversionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

/**
 * REST controller exposing the conversion API.
 *
 * Endpoints:
 *   POST /api/convert          — upload video, returns JSON { jobId, filename }
 *   GET  /api/download/{jobId} — stream the converted MP3
 *   GET  /api/health           — liveness probe
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")   // tighten this in production (e.g. your domain)
public class ConversionController {

    private static final Logger log = LoggerFactory.getLogger(ConversionController.class);

    private final ConversionService conversionService;

    public ConversionController(ConversionService conversionService) {
        this.conversionService = conversionService;
    }

    // ── Health ────────────────────────────────────────────────────────────────

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "ok", "service", "SoundRip"));
    }

    // ── Convert ───────────────────────────────────────────────────────────────

    /**
     * Accepts a multipart video upload and an optional quality parameter.
     *
     * @param file     the uploaded video file (MP4, AVI, MKV, MOV, WMV, FLV …)
     * @param quality  audio bitrate in kbps: 128, 192, or 320 (default 128)
     * @return JSON with jobId and output filename
     */
    @PostMapping(value = "/convert", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> convert(
            @RequestParam("file")    MultipartFile file,
            @RequestParam(value = "quality", defaultValue = "128") int quality) {

        log.info("Conversion request: {} ({} bytes) at {} kbps",
                file.getOriginalFilename(), file.getSize(), quality);

        // Validate quality
        if (quality != 128 && quality != 192 && quality != 320) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid quality. Allowed values: 128, 192, 320"));
        }

        try {
            String jobId = conversionService.convert(file, quality);
            String outputName = stripExtension(file.getOriginalFilename()) + ".mp3";

            return ResponseEntity.ok(Map.of(
                    "jobId",    jobId,
                    "filename", outputName,
                    "message",  "Conversion successful"
            ));

        } catch (IllegalArgumentException e) {
            log.warn("Bad request: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));

        } catch (Exception e) {
            log.error("Conversion failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Conversion failed: " + e.getMessage()));
        }
    }

    // ── Download ──────────────────────────────────────────────────────────────

    /**
     * Streams the converted MP3 back to the browser and schedules cleanup.
     *
     * @param jobId the identifier returned by /api/convert
     */
    @GetMapping("/download/{jobId}")
    public ResponseEntity<Resource> download(@PathVariable String jobId) {

        try {
            Resource mp3 = conversionService.getOutput(jobId);

            if (!mp3.exists()) {
                return ResponseEntity.notFound().build();
            }

            String filename = mp3.getFilename() != null ? mp3.getFilename() : jobId + ".mp3";

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType("audio/mpeg"))
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"" + filename + "\"")
                    .body(mp3);

        } catch (Exception e) {
            log.error("Download failed for jobId={}", jobId, e);
            return ResponseEntity.internalServerError().build();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String stripExtension(String name) {
        if (name == null) return "output";
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }
}
