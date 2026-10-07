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
#    ifndef NOMINMAX
#        define NOMINMAX
#    endif
#    ifndef WIN32_LEAN_AND_MEAN
#        define WIN32_LEAN_AND_MEAN
#    endif
#    include <windows.h>
#else
#    include <spawn.h>
#    include <sys/types.h>
#    include <sys/wait.h>
#    include <unistd.h>
#    include <signal.h>
extern char ** environ;
#endif

static std::string audio_tool_path(const std::string & name) {
    if(name=="audio-separator"){
#ifdef _WIN32
        const auto local=std::filesystem::absolute(".venv-vocal/Scripts/audio-separator.exe");
#else
        const auto local=std::filesystem::absolute(".venv-vocal/bin/audio-separator");
#endif
        if(std::filesystem::exists(local))return local.string();
    }
    return name;
}
static bool audio_tool_available(const std::string & name) {
    const auto resolved=audio_tool_path(name);
    if(resolved!=name)return true;
#ifdef _WIN32
    char path[32768]; return SearchPathA(nullptr,name.c_str(),".exe",sizeof(path),path,nullptr)>0;
#else
    const char * env=getenv("PATH");if(!env)return false;std::string paths(env);size_t start=0;
    do {size_t end=paths.find(':',start);auto path=paths.substr(start,end-start)+"/"+name;if(access(path.c_str(),X_OK)==0)return true;if(end==std::string::npos)break;start=end+1;}while(true);return false;
#endif
}
static thread_local std::atomic<bool> * audio_process_cancel = nullptr;

static int audio_vocal_run(const char * executable, std::vector<std::string> & args) {
    const auto resolved_executable=audio_tool_path(executable);
    executable=resolved_executable.c_str();
    std::vector<char *> argv;
    argv.reserve(args.size() + 1);
    for (std::string & arg : args) argv.push_back(arg.data());
    argv.push_back(nullptr);
#ifdef _WIN32
    // Preserve embedded quotes and paths when _spawnvp joins argv on Windows.
    std::vector<std::string> quoted;quoted.reserve(args.size());
    for(const auto &arg:args){
        std::string q="\"";size_t slashes=0;
        for(char c:arg){if(c=='\\'){slashes++;continue;}
            if(c=='"'){q.append(slashes*2+1,'\\');q+='"';}
            else{q.append(slashes,'\\');q+=c;}slashes=0;
        }
        q.append(slashes*2,'\\');q+='"';quoted.push_back(std::move(q));
    }
    argv.clear();for(auto &arg:quoted)argv.push_back(arg.data());argv.push_back(nullptr);
    const intptr_t rc = _spawnvp(_P_NOWAIT, executable, argv.data());
    if (rc == -1) return errno == ENOENT ? -1 : 1;
    HANDLE process = (HANDLE)rc;
    HANDLE group = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (group) { SetInformationJobObject(group, JobObjectExtendedLimitInformation, &limits, sizeof(limits)); AssignProcessToJobObject(group, process); }
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(30);
    while (WaitForSingleObject(process, 200) == WAIT_TIMEOUT) {
        if ((audio_process_cancel && audio_process_cancel->load()) || std::chrono::steady_clock::now() >= deadline) {
            if (group) TerminateJobObject(group, 1);
            TerminateProcess(process, 1); WaitForSingleObject(process, 5000);
            if (group) CloseHandle(group); CloseHandle(process); return 2;
        }
    }
    DWORD status = 1; GetExitCodeProcess(process, &status);
    if (group) CloseHandle(group); CloseHandle(process);
    return (int)status;
#else
    pid_t pid = -1;
    posix_spawnattr_t attr; posix_spawnattr_init(&attr);
    posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attr,0);
    const int spawn_error = posix_spawnp(&pid, executable, nullptr, &attr, argv.data(), environ);
    posix_spawnattr_destroy(&attr);
    if (spawn_error != 0) return spawn_error == ENOENT ? -1 : 1;
    int status = 0;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(30);
    while (waitpid(pid, &status, WNOHANG) == 0) {
        if ((audio_process_cancel && audio_process_cancel->load()) || std::chrono::steady_clock::now() >= deadline) { kill(-pid,SIGKILL); waitpid(pid,&status,0); return 2; }
        usleep(200000);
    }
    if (!WIFEXITED(status)) return -1;
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
        std::string("[1:a]") + gain + "[v];[0:a][v]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.98:latency=1,aresample=" + rate + ",apad=whole_len=" + std::to_string(samples) + ",atrim=end_sample=" + std::to_string(samples) + ",asetpts=PTS-STARTPTS[out]",
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
