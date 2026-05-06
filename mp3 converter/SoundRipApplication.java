package io.soundrip;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * SoundRip — Spring Boot Application Entry Point
 *
 * Start the server:  mvn spring-boot:run
 * Default port:      8080
 * API base:          http://localhost:8080/api
 */
@SpringBootApplication
public class SoundRipApplication {

    public static void main(String[] args) {
        SpringApplication.run(SoundRipApplication.class, args);
    }
}
