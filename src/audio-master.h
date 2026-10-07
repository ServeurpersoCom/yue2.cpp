#pragma once

// Optional final-stage EBU R128 loudness normalization through FFmpeg.
// The input is kept in memory as float until mastering is requested.

#include "audio-io.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <exception>
#include <string>
#include <vector>

#ifdef _WIN32
#    include <process.h>
#else
#    include <spawn.h>
#    include <sys/types.h>
#    include <sys/wait.h>
#    include <unistd.h>
extern char ** environ;
#endif

static bool audio_master_ffmpeg(const float * audio,
                                int           samples,
                                int           sample_rate,
                                const std::string & profile,
                                std::vector<float> * mastered,
                                std::string * error) {
    if (!audio || samples <= 0 || !mastered) {
        if (error) *error = "no audio to master";
        return false;
    }

    const char * target = nullptr;
    if (profile == "streaming") {
        target = "-14";
    } else if (profile == "broadcast") {
        target = "-23";
    } else {
        if (error) *error = "unknown mastering profile";
        return false;
    }

    namespace fs = std::filesystem;
    static std::atomic<uint64_t> serial{0};
    const uint64_t stamp = (uint64_t) std::chrono::steady_clock::now().time_since_epoch().count();
    const std::string stem = "yue2-master-" + std::to_string(stamp) + "-" + std::to_string(serial.fetch_add(1));

    fs::path input_path;
    fs::path output_path;
    try {
        const fs::path temp = fs::temp_directory_path();
        input_path = temp / (stem + "-in.wav");
        output_path = temp / (stem + "-out.wav");
    } catch (const std::exception & e) {
        if (error) *error = std::string("cannot create temporary paths: ") + e.what();
        return false;
    }

    struct Cleanup {
        fs::path a, b;
        ~Cleanup() {
            std::error_code ec;
            if (!a.empty()) fs::remove(a, ec);
            if (!b.empty()) fs::remove(b, ec);
        }
    } cleanup{input_path, output_path};

    const std::string input_wav = audio_encode_wav_f32(audio, samples, sample_rate);
    if (input_wav.empty()) {
        if (error) *error = "could not encode float audio for mastering";
        return false;
    }
    {
        std::ofstream file(input_path, std::ios::binary);
        file.write(input_wav.data(), (std::streamsize) input_wav.size());
        if (!file) {
            if (error) *error = "could not write temporary audio for mastering";
            return false;
        }
    }

    const std::string filter = std::string("loudnorm=I=") + target + ":LRA=11:TP=-1:print_format=summary";
    std::string input = input_path.string();
    std::string output = output_path.string();
    std::string rate = std::to_string(sample_rate);
    std::vector<std::string> args = {"ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
                                     "-i", input, "-af", filter, "-ar", rate, "-c:a", "pcm_f32le", output};
    std::vector<char *> argv;
    argv.reserve(args.size() + 1);
    for (std::string & arg : args) argv.push_back(arg.data());
    argv.push_back(nullptr);

    int exit_code = -1;
#ifdef _WIN32
    const intptr_t rc = _spawnvp(_P_WAIT, "ffmpeg", argv.data());
    if (rc != -1) exit_code = (int) rc;
#else
    pid_t pid = -1;
    if (posix_spawnp(&pid, "ffmpeg", nullptr, nullptr, argv.data(), environ) == 0) {
        int status = 0;
        if (waitpid(pid, &status, 0) >= 0 && WIFEXITED(status)) exit_code = WEXITSTATUS(status);
    }
#endif
    if (exit_code != 0) {
        if (error) *error = "FFmpeg mastering failed; confirm ffmpeg is installed and supports the loudnorm filter";
        return false;
    }

    int mastered_samples = 0;
    int mastered_rate = 0;
    float * decoded = audio_io_read_wav(output.c_str(), &mastered_samples, &mastered_rate);
    if (!decoded) {
        if (error) *error = "FFmpeg did not produce readable mastered audio";
        return false;
    }
    if (mastered_samples != samples || mastered_rate != sample_rate) {
        free(decoded);
        if (error) *error = "mastered audio format changed unexpectedly";
        return false;
    }
    mastered->assign(decoded, decoded + (size_t) mastered_samples * 2);
    free(decoded);
    return true;
}
