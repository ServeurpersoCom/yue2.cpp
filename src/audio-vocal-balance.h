#pragma once

// Optional vocal balance correction using the local python-audio-separator
// command. The source mix is separated into vocal and accompaniment stems,
// the requested or estimated vocal gain is applied, then both stems are remixed.

#include "audio-io.h"

#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cerrno>
#include <filesystem>
#include <fstream>
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

static int audio_vocal_run(const char * executable, std::vector<std::string> & args) {
    std::vector<char *> argv;
    argv.reserve(args.size() + 1);
    for (std::string & arg : args) argv.push_back(arg.data());
    argv.push_back(nullptr);
#ifdef _WIN32
    const intptr_t rc = _spawnvp(_P_WAIT, executable, argv.data());
    return rc == -1 ? (errno == ENOENT ? -1 : 1) : (int) rc;
#else
    pid_t pid = -1;
    const int spawn_error = posix_spawnp(&pid, executable, nullptr, nullptr, argv.data(), environ);
    if (spawn_error != 0) return spawn_error == ENOENT ? -1 : 1;
    int status = 0;
    if (waitpid(pid, &status, 0) < 0 || !WIFEXITED(status)) return -1;
    return WEXITSTATUS(status);
#endif
}

static bool audio_vocal_balance_ffmpeg(const float * audio,
                                       int samples,
                                       int sample_rate,
                                       float requested_gain_db,
                                       bool auto_gain,
                                       std::vector<float> * balanced,
                                       float * applied_gain_db,
                                       std::string * error) {
    if (!audio || samples <= 0 || !balanced || (!auto_gain && (!std::isfinite(requested_gain_db) || requested_gain_db < -12.0f ||
        requested_gain_db > 12.0f))) {
        if (error) *error = "vocal gain must be between -12 and +12 dB";
        return false;
    }

    namespace fs = std::filesystem;
    static std::atomic<uint64_t> serial{0};
    const uint64_t stamp = (uint64_t) std::chrono::steady_clock::now().time_since_epoch().count();
    const std::string stem = "yue2-vocal-" + std::to_string(stamp) + "-" + std::to_string(serial.fetch_add(1));
    fs::path dir;
    try {
        dir = fs::temp_directory_path() / stem;
        fs::create_directories(dir);
    } catch (const std::exception & e) {
        if (error) *error = std::string("cannot create temporary paths: ") + e.what();
        return false;
    }
    struct Cleanup {
        fs::path path;
        ~Cleanup() { std::error_code ec; fs::remove_all(path, ec); }
    } cleanup{dir};

    const fs::path input = dir / "mix.wav";
    const fs::path output = dir / "balanced.wav";
    const std::string wav = audio_encode_wav_f32(audio, samples, sample_rate);
    if (wav.empty()) {
        if (error) *error = "could not encode audio for vocal balancing";
        return false;
    }
    {
        std::ofstream file(input, std::ios::binary);
        file.write(wav.data(), (std::streamsize) wav.size());
        if (!file) {
            if (error) *error = "could not write temporary audio for vocal balancing";
            return false;
        }
    }

    const fs::path model_dir = dir / "stems";
    std::error_code ec;
    fs::create_directories(model_dir, ec);
    std::string input_arg = input.string();
    std::string out_arg = model_dir.string();
    std::string model_dir_arg = (fs::temp_directory_path() / "yue2-audio-separator-models").string();
    std::vector<std::string> separate = {"audio-separator", input_arg, "--model_filename",
        "model_bs_roformer_ep_317_sdr_12.9755.ckpt", "--output_format", "WAV", "--output_dir", out_arg,
        "--model_file_dir", model_dir_arg, "--custom_output_names",
        "{\"Vocals\":\"vocals\",\"Instrumental\":\"instrumental\"}", "--normalization", "1.0",
        "--use_soundfile"};
    const int separation_status = audio_vocal_run("audio-separator", separate);
    if (separation_status != 0) {
        if (error) {
            *error = separation_status == -1
                ? "audio-separator was not found. Run .\\setup-vocal-separation.ps1 from the YuE2 folder, then restart YuE2."
                : "audio-separator failed. Check its CUDA provider with 'audio-separator --env_info'; the BS-RoFormer model downloads on first use, so check network access too.";
        }
        return false;
    }

    const fs::path vocals = model_dir / "vocals.wav";
    const fs::path backing = model_dir / "instrumental.wav";
    if (!fs::exists(vocals) || !fs::exists(backing)) {
        if (error) *error = "separator did not create the expected vocals and instrumental stems";
        return false;
    }
    float vocal_gain_db = requested_gain_db;
    if (auto_gain) {
        int vocal_samples = 0, vocal_rate = 0, backing_samples = 0, backing_rate = 0;
        float * vocal = audio_io_read_wav(vocals.string().c_str(), &vocal_samples, &vocal_rate);
        float * instrumental = audio_io_read_wav(backing.string().c_str(), &backing_samples, &backing_rate);
        if (!vocal || !instrumental || vocal_samples <= 0 || backing_samples <= 0 || vocal_rate != backing_rate) {
            free(vocal);
            free(instrumental);
            if (error) *error = "could not analyze separated stems for automatic vocal balance";
            return false;
        }
        const int length = std::min(vocal_samples, backing_samples);
        const int window = std::max(1, vocal_rate * 2 / 5); // 400 ms level-analysis windows
        float peak_vocal_rms = 0.0f;
        for (int start = 0; start < length; start += window) {
            const int count = std::min(window, length - start);
            double energy = 0.0;
            for (int i = 0; i < count; i++) {
                const double l = vocal[(size_t) start + i];
                const double r = vocal[(size_t) vocal_samples + start + i];
                energy += l * l + r * r;
            }
            peak_vocal_rms = std::max(peak_vocal_rms, (float) std::sqrt(energy / (2.0 * count)));
        }
        const float vocal_gate = std::max(0.0005f, peak_vocal_rms * 0.08f);
        std::vector<float> ratios;
        for (int start = 0; start < length; start += window) {
            const int count = std::min(window, length - start);
            double vocal_energy = 0.0, backing_energy = 0.0;
            for (int i = 0; i < count; i++) {
                const size_t left = (size_t) start + i;
                const size_t right_v = (size_t) vocal_samples + left;
                const size_t right_b = (size_t) backing_samples + left;
                const double vl = vocal[left], vr = vocal[right_v];
                const double bl = instrumental[left], br = instrumental[right_b];
                vocal_energy += vl * vl + vr * vr;
                backing_energy += bl * bl + br * br;
            }
            const float vrms = (float) std::sqrt(vocal_energy / (2.0 * count));
            const float brms = (float) std::sqrt(backing_energy / (2.0 * count));
            if (vrms >= vocal_gate && brms > 0.0001f) ratios.push_back(20.0f * std::log10(vrms / brms));
        }
        free(vocal);
        free(instrumental);
        if (ratios.empty()) {
            if (error) *error = "could not find active vocal passages for automatic balance; try the manual gain";
            return false;
        }
        const size_t mid = ratios.size() / 2;
        std::nth_element(ratios.begin(), ratios.begin() + mid, ratios.end());
        const float median_ratio_db = ratios[mid];
        // A conservative starting point: vocals slightly ahead of the backing
        // in sections where the vocal stem is active. This is a heuristic, not
        // a universal mix standard; the user can still fine-tune the result.
        vocal_gain_db = std::clamp(1.0f - median_ratio_db, -6.0f, 6.0f);
    }
    char gain[64];
    snprintf(gain, sizeof(gain), "volume=%.6fdB", (double) vocal_gain_db);
    std::string vocal_arg = vocals.string();
    std::string backing_arg = backing.string();
    std::string output_arg = output.string();
    std::string rate = std::to_string(sample_rate);
    std::vector<std::string> remix = {"ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
        "-i", backing_arg, "-i", vocal_arg, "-filter_complex",
        std::string("[1:a]") + gain + "[v];[0:a][v]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.98,atrim=end_sample=" + std::to_string(samples) + ",asetpts=PTS-STARTPTS[out]",
        "-map", "[out]", "-ar", rate, "-c:a", "pcm_f32le", output_arg};
    const int ffmpeg_status = audio_vocal_run("ffmpeg", remix);
    if (ffmpeg_status != 0) {
        if (error) *error = ffmpeg_status == -1
            ? "FFmpeg was not found. Install FFmpeg and add it to PATH, then restart YuE2."
            : "FFmpeg could not remix the stems. Check that FFmpeg is available on PATH and the separated WAV files are readable.";
        return false;
    }
    int result_samples = 0, result_rate = 0;
    float * decoded = audio_io_read_wav(output.string().c_str(), &result_samples, &result_rate);
    if (!decoded) {
        if (error) *error = "FFmpeg did not produce readable remixed audio";
        return false;
    }
    if (result_samples != samples || result_rate != sample_rate) {
        free(decoded);
        if (error) *error = "remixed audio format changed unexpectedly";
        return false;
    }
    balanced->assign(decoded, decoded + (size_t) result_samples * 2);
    free(decoded);
    if (applied_gain_db) *applied_gain_db = vocal_gain_db;
    return true;
}
