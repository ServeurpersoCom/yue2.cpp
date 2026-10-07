#pragma once

// 16:9 video render for YouTube delivery: a still cover image plus the full
// length finished track becomes an MP4 (H.264 + AAC) via the local FFmpeg
// binary. Used by POST /render-video. The uploads are never modified.

#include "audio-vocal-balance.h"  // process runner, temp dir and error conventions

#include <cctype>
#include <fstream>
#include <string>

// extension of an upload filename, lowercased, with a leading dot. Falls
// back when the client sends no filename.
static std::string video_ext_of(const std::string & filename, const char * fallback) {
    const size_t dot = filename.find_last_of('.');
    std::string ext = dot == std::string::npos ? fallback : filename.substr(dot);
    for (char & c : ext) c = (char) tolower((unsigned char) c);
    return ext;
}

static bool audio_render_video_ffmpeg(const std::string & cover_bytes,
                                      const std::string & cover_ext,
                                      const std::string & audio_bytes,
                                      const std::string & audio_ext,
                                      std::string * mp4,
                                      std::string * error) {
    if (cover_bytes.empty() || audio_bytes.empty() || !mp4) {
        if (error) *error = "cover image and audio are both required";
        return false;
    }

    // Bound the video timeline explicitly. At 1 fps, encoder lookahead can
    // otherwise leave a long silent tail even with -shortest.
    int samples=0,sample_rate=0;
    float *decoded=audio_read_buf(reinterpret_cast<const uint8_t *>(audio_bytes.data()),audio_bytes.size(),&samples,&sample_rate);
    if(!decoded || samples<=0 || sample_rate<=0){free(decoded);if(error)*error="Audio could not be decoded for video export";return false;}
    free(decoded);
    const std::string duration=std::to_string(std::ceil((double)samples/sample_rate));
    namespace fs = std::filesystem;
    static std::atomic<uint64_t> serial{0};
    const uint64_t stamp = (uint64_t) std::chrono::steady_clock::now().time_since_epoch().count();
    const std::string stem = "yue2-video-" + std::to_string(stamp) + "-" + std::to_string(serial.fetch_add(1));
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

    const fs::path cover  = dir / ("cover" + cover_ext);
    const fs::path audio  = dir / ("audio" + audio_ext);
    const fs::path output = dir / "song.mp4";
    auto write = [&](const fs::path & path, const std::string & bytes, const char * what) {
        std::ofstream file(path, std::ios::binary);
        file.write(bytes.data(), (std::streamsize) bytes.size());
        if (!file && error) *error = std::string("could not write temporary ") + what;
        return (bool) file;
    };
    if (!write(cover, cover_bytes, "cover image") || !write(audio, audio_bytes, "audio")) {
        return false;
    }

    // Still image at 1 fps, cover-cropped to 1920x1080, broadcast-safe
    // pixel format, faststart so YouTube can process while uploading.
    std::vector<std::string> render = {"ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-framerate",
        "1",
        "-i",
        cover.string(),
        "-i",
        audio.string(),
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        duration,
        "-movflags",
        "+faststart",
        output.string()};
    const int status = audio_vocal_run("ffmpeg", render);
    if (status != 0) {
        if (error) {
            *error = status == -1 ? "FFmpeg was not found. Install FFmpeg and add it to PATH, then restart YuE2."
                                  : "FFmpeg could not render the video. Check that FFmpeg includes libx264.";
        }
        return false;
    }
    if (fs::file_size(output) > 256ULL * 1024 * 1024) { if (error) *error = "Video exceeds the 256 MiB delivery limit. Use a shorter track."; return false; }
    std::ifstream file(output, std::ios::binary);
    if (!file) {
        if (error) *error = "FFmpeg did not produce a video file";
        return false;
    }
    mp4->assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    if (mp4->size() < 1024) {
        if (error) *error = "FFmpeg produced an empty video file";
        mp4->clear();
        return false;
    }
    return true;
}
