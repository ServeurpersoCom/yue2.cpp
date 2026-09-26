// yue-server.cpp: HTTP server (async job queue + embedded webui)
//
// The compute endpoint creates a job and returns its ID immediately. A single
// worker thread owns the resident models and runs jobs in FIFO order. The
// client polls the job and fetches its result, which pairs a replay request
// with its audio: the replay carries the semantic stream, the score and the
// resolved seed, so re-rendering never pays the autoregression again.
//
// The binary orchestrates only: generation, cancellation and encoding all
// live in src/.

#include "audio-io.h"
#include "audio-master.h"
#include "audio-vocal-balance.h"
#include "httplib.h"
#include "index.html.gz.hpp"
#include "pipeline.h"
#include "version.h"
#include "yyjson.h"
#include "comfy-api.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cmath>
#include <exception>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#    include <fcntl.h>
#    include <io.h>
#    ifndef STDERR_FILENO
#        define STDERR_FILENO 2
#    endif
#else
#    include <unistd.h>
#endif

// portable fd wrappers. avoids macros that collide with C++ method names
// (e.g. sink.write() in httplib would be eaten by a write() macro).
#ifdef _WIN32
static int fd_pipe(int fd[2]) {
    return _pipe(fd, 4096, _O_BINARY);
}

static int fd_dup(int fd) {
    return _dup(fd);
}

static int fd_dup2(int src, int dst) {
    return _dup2(src, dst);
}

static int fd_read(int fd, void * buf, size_t n) {
    return _read(fd, buf, (unsigned) n);
}

static int fd_write(int fd, const void * buf, size_t n) {
    return _write(fd, buf, (unsigned) n);
}

static void fd_close(int fd) {
    _close(fd);
}
#else
static int fd_pipe(int fd[2]) {
    return pipe(fd);
}

static int fd_dup(int fd) {
    return dup(fd);
}

static int fd_dup2(int src, int dst) {
    return dup2(src, dst);
}

static int fd_read(int fd, void * buf, size_t n) {
    return (int) read(fd, buf, n);
}

static int fd_write(int fd, const void * buf, size_t n) {
    return (int) write(fd, buf, n);
}

static void fd_close(int fd) {
    close(fd);
}
#endif

static httplib::Server * g_svr = nullptr;

// Build a multipart/mixed body with one JSON replay request part followed by
// its audio part, per rendered track. The boundary is fixed; the client splits
// on it and types parts by their header.
static const char * MULTIPART_BOUNDARY = "yue2-batch-boundary";

static std::string multipart_build_tracks(const std::vector<std::string> & request_parts,
                                          const std::vector<std::string> & audio_parts,
                                          const char *                     audio_mime) {
    // One set of literal fragments sizes the body exactly and builds it:
    // audio parts weigh tens of MB, growing the string through repeated
    // appends would reallocate and copy them
    const char * dash       = "--";
    const char * json_head  = "\r\nContent-Type: application/json\r\n\r\n";
    const char * audio_head = "\r\nContent-Type: ";
    const char * head_end   = "\r\n\r\n";
    const char * crlf       = "\r\n";
    const char * close_end  = "--\r\n";

    const size_t boundary_len = strlen(MULTIPART_BOUNDARY);
    const size_t per_track    = 2 * strlen(dash) + 2 * boundary_len + strlen(json_head) + 2 * strlen(crlf) +
                             strlen(audio_head) + strlen(audio_mime) + strlen(head_end);
    size_t total = strlen(dash) + boundary_len + strlen(close_end);
    for (size_t i = 0; i < audio_parts.size(); i++) {
        total += per_track + request_parts[i].size() + audio_parts[i].size();
    }

    std::string body;
    body.reserve(total);
    for (size_t i = 0; i < audio_parts.size(); i++) {
        body += dash;
        body += MULTIPART_BOUNDARY;
        body += json_head;
        body += request_parts[i];
        body += crlf;
        body += dash;
        body += MULTIPART_BOUNDARY;
        body += audio_head;
        body += audio_mime;
        body += head_end;
        body += audio_parts[i];
        body += crlf;
    }
    body += dash;
    body += MULTIPART_BOUNDARY;
    body += close_end;
    return body;
}

static const std::string MULTIPART_MIME = std::string("multipart/mixed; boundary=") + MULTIPART_BOUNDARY;

// job system: the compute endpoint creates a job and returns its ID
// immediately. the worker thread processes jobs in FIFO order, stores
// the result. the client polls GET /job?id=N until done, then fetches
// the result with GET /job?id=N&result=1.
// cancel: POST /job?id=N&cancel=1 sets the per-job flag.
enum class JobStatus : int {
    RUNNING   = 0,
    DONE      = 1,
    FAILED    = 2,
    CANCELLED = 3,
};

struct Job {
    std::string            id;
    std::atomic<JobStatus> status{ JobStatus::RUNNING };
    std::string            result_body;
    std::string            result_mime;
    std::atomic<bool>      cancel{ false };

    // memory ordering contract: result_body and result_mime are written
    // before status is stored (seq_cst). the client loads status (seq_cst)
    // and only reads result fields after seeing done/failed. this guarantees
    // visibility without an explicit mutex on the result fields.
};

static std::mutex                                            mtx_jobs;
static std::unordered_map<std::string, std::shared_ptr<Job>> g_jobs;
static std::deque<std::string>                               g_job_order;
static const int                                             MAX_JOBS = 32;

// job currently on the GPU, tracked so shutdown can cancel it and return
// within one pipeline cancel poll instead of waiting out the generation.
static std::mutex           mtx_active;
static std::shared_ptr<Job> g_active_job;

static void active_job_set(std::shared_ptr<Job> job) {
    std::lock_guard<std::mutex> lock(mtx_active);
    g_active_job = std::move(job);
}

static void active_job_cancel() {
    std::lock_guard<std::mutex> lock(mtx_active);
    if (g_active_job && g_active_job->status.load() == JobStatus::RUNNING) {
        fprintf(stderr, "[Server] Cancelling active job %s\n", g_active_job->id.c_str());
        g_active_job->cancel.store(true);
    }
}

// cancel callback the pipeline polls, reads the per-job atomic flag
static bool server_cancel_job(void * data) {
    auto * flag = (const std::atomic<bool> *) data;
    return flag && flag->load(std::memory_order_relaxed);
}

// generate a random hex ID (64 bits of entropy, non-predictable)
static std::string job_make_id() {
    static std::mt19937_64      rng(std::random_device{}());
    static std::mutex           mtx_rng;
    std::lock_guard<std::mutex> lock(mtx_rng);
    char                        buf[17];
    snprintf(buf, sizeof(buf), "%016llx", (unsigned long long) rng());
    return buf;
}

static std::shared_ptr<Job> job_create() {
    std::lock_guard<std::mutex> lock(mtx_jobs);
    int pending = 0;
    for (const auto & entry : g_jobs) {
        if (entry.second->status.load() == JobStatus::RUNNING) ++pending;
    }
    // Includes the executing job. Admission is checked under the same lock
    // as insertion, so concurrent HTTP requests cannot oversubscribe it.
    if (pending >= 4) return nullptr;
    auto                        job = std::make_shared<Job>();
    job->id                         = job_make_id();
    g_jobs[job->id]                 = job;
    g_job_order.push_back(job->id);

    // evict oldest completed jobs to stay under MAX_JOBS.
    // running jobs are never evicted.
    while ((int) g_job_order.size() > MAX_JOBS) {
        bool evicted = false;
        for (auto it = g_job_order.begin(); it != g_job_order.end(); ++it) {
            auto jit = g_jobs.find(*it);
            if (jit == g_jobs.end() || jit->second->status.load() != JobStatus::RUNNING) {
                if (jit != g_jobs.end()) {
                    g_jobs.erase(jit);
                }
                g_job_order.erase(it);
                evicted = true;
                break;
            }
        }
        if (!evicted) {
            break;
        }
    }
    return job;
}

static std::shared_ptr<Job> job_find(const std::string & id) {
    std::lock_guard<std::mutex> lock(mtx_jobs);
    auto                        it = g_jobs.find(id);
    return it != g_jobs.end() ? it->second : nullptr;
}

static const char * job_status_str(JobStatus s) {
    switch (s) {
        case JobStatus::RUNNING:
            return "running";
        case JobStatus::DONE:
            return "done";
        case JobStatus::FAILED:
            return "failed";
        case JobStatus::CANCELLED:
            return "cancelled";
    }
    return "running";
}

// log capture: intercept stderr via pipe, forward to terminal + ring buffer.
// SSE clients connect to /logs and receive lines in real time.
#define LOG_RING_BITS 9
#define LOG_RING_SIZE (1 << LOG_RING_BITS)
#define LOG_RING_MASK (LOG_RING_SIZE - 1)

static std::mutex              mtx_log;
static std::condition_variable cv_log;
static std::string             log_ring[LOG_RING_SIZE];
static uint64_t                log_seq = 0;

static int         g_real_stderr_fd = -1;
static int         g_pipe_read_fd   = -1;
static std::thread g_log_reader;

// reader thread: drain pipe, forward to real stderr, push lines to ring.
// exits when the write end of the pipe is closed (fd_dup2 restores real stderr).
static void log_reader_main() {
    char        buf[4096];
    std::string partial;
    for (;;) {
        int n = fd_read(g_pipe_read_fd, buf, sizeof(buf));
        if (n <= 0) {
            break;
        }
        fd_write(g_real_stderr_fd, buf, (size_t) n);
        partial.append(buf, (size_t) n);
        size_t pos;
        while ((pos = partial.find('\n')) != std::string::npos) {
            std::lock_guard<std::mutex> lock(mtx_log);
            log_ring[log_seq & LOG_RING_MASK] = partial.substr(0, pos);
            log_seq++;
            cv_log.notify_all();
            partial.erase(0, pos + 1);
        }
    }
    if (!partial.empty()) {
        std::lock_guard<std::mutex> lock(mtx_log);
        log_ring[log_seq & LOG_RING_MASK] = std::move(partial);
        log_seq++;
        cv_log.notify_all();
    }
    fd_close(g_pipe_read_fd);
}

// Restore stderr and drain the reader before the pipe dies with the process.
// Idempotent: the destructor and the exit hook both land here, either order.
static void log_capture_stop() {
    if (g_real_stderr_fd < 0) {
        return;
    }
    fflush(stderr);
    // the restore drops the last write end, so the reader reads EOF and returns
    fd_dup2(g_real_stderr_fd, STDERR_FILENO);
    cv_log.notify_all();
    if (g_log_reader.joinable()) {
        g_log_reader.join();
    }
    fd_close(g_real_stderr_fd);
    g_real_stderr_fd = -1;
}

static void setup_log_capture() {
    g_real_stderr_fd = fd_dup(STDERR_FILENO);
    int pipefd[2];
    if (fd_pipe(pipefd) != 0) {
        fd_close(g_real_stderr_fd);
        g_real_stderr_fd = -1;
        return;
    }
    g_pipe_read_fd = pipefd[0];
    fd_dup2(pipefd[1], STDERR_FILENO);
    fd_close(pipefd[1]);
    // A loader aborts the process with exit() on a fatal error, which skips
    // every destructor: the hook still drains the pipe, so the message that
    // explains the failure reaches the terminal.
    atexit(log_capture_stop);
    g_log_reader = std::thread(log_reader_main);
}

// RAII: captures stderr on construction, restores and drains on destruction.
struct LogCapture {
    LogCapture() { setup_log_capture(); }

    ~LogCapture() { log_capture_stop(); }
};

// GET /logs: SSE stream of stderr lines.
// sends backlog (up to LOG_RING_SIZE) then streams new lines in real time.
static void handle_logs(const httplib::Request &, httplib::Response & res) {
    res.set_header("Cache-Control", "no-cache");
    res.set_header("X-Accel-Buffering", "no");
    res.set_chunked_content_provider(
        "text/event-stream", [cursor = uint64_t(0), init = false](size_t, httplib::DataSink & sink) mutable -> bool {
            std::unique_lock<std::mutex> lock(mtx_log);
            if (!init) {
                uint64_t avail = log_seq < LOG_RING_SIZE ? log_seq : (uint64_t) LOG_RING_SIZE;
                cursor         = log_seq - avail;
                while (cursor < log_seq) {
                    std::string ev = "data: " + log_ring[cursor & LOG_RING_MASK] + "\n\n";
                    cursor++;
                    lock.unlock();
                    if (!sink.write(ev.c_str(), ev.size())) {
                        return false;
                    }
                    lock.lock();
                }
                init = true;
            }
            cv_log.wait_for(lock, std::chrono::seconds(2));
            while (cursor < log_seq) {
                std::string ev = "data: " + log_ring[cursor & LOG_RING_MASK] + "\n\n";
                cursor++;
                lock.unlock();
                if (!sink.write(ev.c_str(), ev.size())) {
                    return false;
                }
                lock.lock();
            }
            return true;
        });
}

// work queue: one worker owns the models, jobs run in FIFO order
static std::deque<std::function<void()>> g_work_queue;
static std::mutex                        mtx_work;
static std::condition_variable           cv_work;
static bool                              g_work_stop = false;

static void work_push(std::shared_ptr<Job> job, std::function<void()> fn) {
    {
        std::lock_guard<std::mutex> lock(mtx_work);
        if (g_work_stop) {
            job->status.store(JobStatus::CANCELLED);
            return;
        }
        g_work_queue.push_back([job, fn = std::move(fn)] {
            if (job->cancel.load()) {
                job->status.store(JobStatus::CANCELLED);
                return;
            }
            try {
                fn();
            } catch (const std::exception & error) {
                fprintf(stderr, "[Server] Job %s failed: %s\n", job->id.c_str(), error.what());
                job->status.store(JobStatus::FAILED);
            } catch (...) {
                fprintf(stderr, "[Server] Job %s failed: unknown exception\n", job->id.c_str());
                job->status.store(JobStatus::FAILED);
            }
            active_job_set(nullptr);
        });
    }
    cv_work.notify_one();
}

static void worker_main() {
    for (;;) {
        std::function<void()> job;
        {
            std::unique_lock<std::mutex> lock(mtx_work);
            cv_work.wait(lock, [] { return g_work_stop || !g_work_queue.empty(); });
            if (g_work_stop && g_work_queue.empty()) {
                return;
            }
            job = std::move(g_work_queue.front());
            g_work_queue.pop_front();
        }
        job();
    }
}

static Yue2Pipeline g_pipeline;
static bool         g_keep_loaded = false;
static std::string  g_model_path;
static std::string  g_vae_path;
static std::string  g_transcriber_path;

static void on_signal(int) {
    active_job_cancel();
    if (g_svr) {
        g_svr->stop();
    }
}

static std::string json_string(const char * key, const std::string & value) {
    yyjson_mut_doc * doc  = yyjson_mut_doc_new(NULL);
    yyjson_mut_val * root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    yyjson_mut_obj_add_strncpy(doc, root, key, value.c_str(), value.size());
    char *      json = yyjson_mut_write(doc, 0, NULL);
    std::string out  = json ? json : "{}";
    if (json) {
        free(json);
    }
    yyjson_mut_doc_free(doc);
    return out;
}

static void handle_props(const httplib::Request &, httplib::Response & res) {
    Yue2Request d;
    request_init(&d);

    yyjson_mut_doc * doc  = yyjson_mut_doc_new(NULL);
    yyjson_mut_val * root = yyjson_mut_obj(doc);
    yyjson_mut_doc_set_root(doc, root);
    yyjson_mut_obj_add_str(doc, root, "version", YUE2_VERSION);
    yyjson_mut_obj_add_strncpy(doc, root, "model", g_model_path.c_str(), g_model_path.size());
    yyjson_mut_obj_add_strncpy(doc, root, "vae", g_vae_path.c_str(), g_vae_path.size());
    yyjson_mut_obj_add_int(doc, root, "sample_rate", YUE2_SAMPLE_RATE);
    yyjson_mut_obj_add_int(doc, root, "frame_rate", YUE2_FRAME_RATE);
    yyjson_mut_obj_add_int(doc, root, "context", YUE2_CONTEXT);

    // The defaults are the request schema itself, serialized by the request
    // writer and grafted here: one source of truth, one float formatting
    std::string  def_json = request_to_json(&d, false);
    yyjson_doc * def_doc  = yyjson_read(def_json.c_str(), def_json.size(), 0);
    if (def_doc) {
        yyjson_mut_obj_add_val(doc, root, "defaults", yyjson_val_mut_copy(doc, yyjson_doc_get_root(def_doc)));
        yyjson_doc_free(def_doc);
    }

    char * json = yyjson_mut_write(doc, 0, NULL);
    res.set_content(json ? json : "{}", "application/json");
    if (json) {
        free(json);
    }
    yyjson_mut_doc_free(doc);
}

// Validates what the pipeline would refuse anyway, so a bad request fails
// fast with a 400 instead of occupying the worker
static bool validate(const httplib::Request & req, httplib::Response & res, Yue2Request * r) {
    if (req.body.size() > 1024 * 1024) {
        res.status = 413;
        res.set_content(json_string("error", "generation request exceeds 1 MiB"), "application/json");
        return false;
    }
    if (!request_parse_json(r, req.body.c_str())) {
        res.status = 400;
        res.set_content(json_string("error", "invalid JSON"), "application/json");
        return false;
    }
    Yue2Cot cot;
    if (!yue2_cot_parse(r->cot, &cot)) {
        res.status = 400;
        res.set_content(json_string("error", "cot must be full, melody or off"), "application/json");
        return false;
    }
    bool      is_mp3  = false;
    WavFormat wav_fmt = WAV_S16;
    if (!audio_parse_format(r->output_format.c_str(), is_mp3, wav_fmt)) {
        res.status = 400;
        res.set_content(json_string("error", "unknown output format"), "application/json");
        return false;
    }
    if (r->mastering_profile != "off" && r->mastering_profile != "streaming" &&
        r->mastering_profile != "broadcast") {
        res.status = 400;
        res.set_content(json_string("error", "mastering_profile must be off, streaming or broadcast"), "application/json");
        return false;
    }
    if (r->steps < 1 || r->steps > 200) {
        res.status = 400;
        res.set_content(json_string("error", "steps must be between 1 and 200"), "application/json");
        return false;
    }
    if (!std::isfinite(r->duration) || r->duration < 0 || r->duration > 600 ||
        !std::isfinite(r->cfg_scale) || r->cfg_scale < -1 || r->cfg_scale > 30 ||
        r->peak_clip < 0 || r->peak_clip > 999) {
        res.status = 400;
        res.set_content(json_string("error", "duration must be 0 (auto) to 600 seconds, CFG -1 to 30, peak clip 0 to 999"), "application/json");
        return false;
    }
    if (is_mp3 && r->mp3_bitrate != 32 && r->mp3_bitrate != 40 && r->mp3_bitrate != 48 &&
        r->mp3_bitrate != 56 && r->mp3_bitrate != 64 && r->mp3_bitrate != 80 &&
        r->mp3_bitrate != 96 && r->mp3_bitrate != 112 && r->mp3_bitrate != 128 &&
        r->mp3_bitrate != 160 && r->mp3_bitrate != 192 && r->mp3_bitrate != 224 &&
        r->mp3_bitrate != 256 && r->mp3_bitrate != 320) {
        res.status = 400;
        res.set_content(json_string("error", "unsupported MP3 bitrate; recommended: 320 kbps"), "application/json");
        return false;
    }
    if (r->lm_batch_size < 1 || r->lm_batch_size > g_pipeline.params.max_batch) {
        res.status = 400;
        res.set_content(json_string("error", "lm_batch_size exceeds --max-batch"), "application/json");
        return false;
    }
    if (r->synth_batch_size < 1 || r->synth_batch_size > 9) {
        res.status = 400;
        res.set_content(json_string("error", "synth_batch_size must be between 1 and 9"), "application/json");
        return false;
    }
    if (!yue2_sampling_valid(r->abc_sampling, "abc") || !yue2_sampling_valid(r->semantic_sampling, "semantic")) {
        res.status = 400;
        res.set_content(json_string("error", "sampling preset outside the protocol bounds"), "application/json");
        return false;
    }
    request_resolve_seed(r);
    return true;
}

// Transcribe worker: the uploaded recording becomes an ABC score, the chord
// symbols dropped when only the melody is wanted.
static void run_transcribe(std::shared_ptr<Job> job, std::vector<float> audio, bool melody_only) {
    active_job_set(job);
    fprintf(stderr, "[Server] Transcribe job %s: %.1f s of audio, %s\n", job->id.c_str(),
            (double) audio.size() / SS2_SAMPLE_RATE, melody_only ? "melody only" : "full score");
    std::string abc, error;
    bool        ok = pipeline_transcribe(&g_pipeline, audio.data(), (int) audio.size(), melody_only, &abc, &error);
    active_job_set(nullptr);
    if (!ok) {
        fprintf(stderr, "[Server] Transcribe job %s failed: %s\n", job->id.c_str(), error.c_str());
        job->status.store(job->cancel.load() ? JobStatus::CANCELLED : JobStatus::FAILED);
        return;
    }
    job->result_body = json_string("abc", abc);
    job->result_mime = "application/json";
    job->status.store(JobStatus::DONE);
}

static void run_job(std::shared_ptr<Job> job, Yue2Request request) {
    active_job_set(job);
    fprintf(stderr, "[Server] Job %s: %s\n", job->id.c_str(), request_to_json(&request).c_str());

    std::vector<Yue2Song> songs;
    bool ok = pipeline_generate(&g_pipeline, request, &songs, server_cancel_job, (void *) &job->cancel);

    if (!ok) {
        active_job_set(nullptr);
        job->status.store(job->cancel.load() ? JobStatus::CANCELLED : JobStatus::FAILED);
        return;
    }

    bool      is_mp3  = false;
    WavFormat wav_fmt = WAV_S16;
    audio_parse_format(request.output_format.c_str(), is_mp3, wav_fmt);

    // One part pair per track, song-major. The replay request of a track
    // carries its semantic stream, its score and the seeds it consumed, so a
    // resubmit reproduces it without the autoregression.
    const int                M = request.synth_batch_size;
    std::vector<std::string> audio_parts;
    std::vector<std::string> request_parts;
    for (size_t t = 0; t < songs.size(); t++) {
        Yue2Song & song = songs[t];
        if (request.mastering_profile != "off") {
            std::vector<float> mastered;
            std::string error;
            if (!audio_master_ffmpeg(song.audio.data(), song.T_audio, YUE2_SAMPLE_RATE,
                                     request.mastering_profile, &mastered, &error)) {
                fprintf(stderr, "[Master] Job %s failed: %s\n", job->id.c_str(), error.c_str());
                active_job_set(nullptr);
                job->status.store(JobStatus::FAILED);
                return;
            }
            // Keep the original take beside its master for in-app A/B preview.
            if (is_mp3 || wav_fmt != WAV_F32) {
                audio_normalize(song.audio.data(), song.T_audio * 2, request.peak_clip);
            }
            audio_parts.push_back(
                is_mp3 ? audio_encode_mp3(song.audio.data(), song.T_audio, YUE2_SAMPLE_RATE, request.mp3_bitrate) :
                         audio_encode_wav(song.audio.data(), song.T_audio, YUE2_SAMPLE_RATE, wav_fmt));
            if (audio_parts.back().empty()) {
                active_job_set(nullptr);
                job->status.store(JobStatus::FAILED);
                return;
            }
            Yue2Request original = request_replay(request, song.score.empty() ? request.abc : song.score,
                                                  pipeline_format_tokens(song.tokens), (int) t / M, (int) t % M);
            original.mastering_profile = "off";
            request_parts.push_back(request_to_json(&original));
            song.audio.swap(mastered);
        // Normalization belongs to the output stage; WAV32 keeps the full range.
        } else if (is_mp3 || wav_fmt != WAV_F32) {
            audio_normalize(song.audio.data(), song.T_audio * 2, request.peak_clip);
        }
        audio_parts.push_back(
            is_mp3 ? audio_encode_mp3(song.audio.data(), song.T_audio, YUE2_SAMPLE_RATE, request.mp3_bitrate) :
                     audio_encode_wav(song.audio.data(), song.T_audio, YUE2_SAMPLE_RATE, wav_fmt));
        if (audio_parts.back().empty()) {
            active_job_set(nullptr);
            job->status.store(JobStatus::FAILED);
            return;
        }
        Yue2Request replay = request_replay(request, song.score.empty() ? request.abc : song.score,
                                            pipeline_format_tokens(song.tokens), (int) t / M, (int) t % M);
        request_parts.push_back(request_to_json(&replay));
    }

    active_job_set(nullptr);
    job->result_body = multipart_build_tracks(request_parts, audio_parts, is_mp3 ? "audio/mpeg" : "audio/wav");
    job->result_mime = MULTIPART_MIME;
    job->status.store(JobStatus::DONE);
}

static void print_usage(const char * prog) {
    fprintf(stderr, "yue2.cpp %s\n\n", YUE2_VERSION);
    fprintf(stderr,
            "Usage: %s --model <gguf> --vae <gguf> [options]\n"
            "\n"
            "Required:\n"
            "  --model <gguf>         Backbone GGUF\n"
            "  --vae <gguf>           VAE GGUF\n"
            "\n"
            "Optional:\n"
            "  --transcriber <gguf>   SheetSage2 GGUF, enables /transcribe\n"
            "  --host <addr>          Listen address (default: 127.0.0.1)\n"
            "  --port <N>             Listen port (default: 8087)\n"
            "  --max-batch <N>        Song batch limit, one KV set each (default: 1)\n"
            "  --keep-loaded          Keep every model resident in VRAM (default: evict between stages)\n"
            "\n"
            "Debug:\n"
            "  --max-seq <N>          KV cache size (default: model context)\n"
            "  --vae-core <N>         VAE tile core frames (default: 512)\n"
            "  --vae-halo <N>         VAE tile halo frames (default: 16)\n"
            "  --no-fa                Disable flash attention\n"
            "  --clamp-fp16           Clamp hidden states to FP16 range\n",
            prog);
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    const char *       host = "127.0.0.1";
    int                port = 8087;
    int                comfy_port = 8188;
    Yue2PipelineParams params;

    for (int i = 1; i < argc; i++) {
        bool last = i + 1 >= argc;
        if (!strcmp(argv[i], "--model") && !last) {
            g_model_path = argv[++i];
        } else if (!strcmp(argv[i], "--vae") && !last) {
            g_vae_path = argv[++i];
        } else if (!strcmp(argv[i], "--transcriber") && !last) {
            g_transcriber_path = argv[++i];
        } else if (!strcmp(argv[i], "--comfy-port") && !last) {
            comfy_port = atoi(argv[++i]);
            if (comfy_port < 1 || comfy_port > 65535) return 1;
        } else if (!strcmp(argv[i], "--host") && !last) {
            host = argv[++i];
        } else if (!strcmp(argv[i], "--port") && !last) {
            port = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--keep-loaded")) {
            g_keep_loaded = true;
        } else if (!strcmp(argv[i], "--max-batch") && !last) {
            params.max_batch = atoi(argv[++i]);
            if (params.max_batch < 1) {
                params.max_batch = 1;
            }
        } else if (!strcmp(argv[i], "--max-seq") && !last) {
            params.max_seq = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--vae-core") && !last) {
            params.vae_core = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--vae-halo") && !last) {
            params.vae_halo = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--no-fa")) {
            params.no_fa = true;
        } else if (!strcmp(argv[i], "--clamp-fp16")) {
            params.clamp_fp16 = true;
        } else {
            print_usage(argv[0]);
            return 1;
        }
    }

    if (g_model_path.empty() || g_vae_path.empty()) {
        print_usage(argv[0]);
        return 1;
    }

    auto readable_model_file = [](const std::string & path) {
        std::error_code ec;
        return std::filesystem::is_regular_file(std::filesystem::path(path), ec) && !ec;
    };
    if (!readable_model_file(g_model_path)) {
        fprintf(stderr, "[Startup] Required backbone model not found or not a file: %s\n"
                        "[Startup] Check the --model path or put the GGUF in models\\ and launch music again.\n",
                g_model_path.c_str());
        return 1;
    }
    if (!readable_model_file(g_vae_path)) {
        fprintf(stderr, "[Startup] Required VAE model not found or not a file: %s\n"
                        "[Startup] Check the --vae path or put the GGUF in models\\ and launch music again.\n",
                g_vae_path.c_str());
        return 1;
    }
    if (!g_transcriber_path.empty() && !readable_model_file(g_transcriber_path)) {
        fprintf(stderr, "[Startup] Optional transcriber model not found: %s\n"
                        "[Startup] Music generation will work, but audio transcription is disabled.\n",
                g_transcriber_path.c_str());
        g_transcriber_path.clear();
    }

    LogCapture log_capture;

    // Model loads go through the store: STRICT by default (one half of the
    // backbone resident at a time, the cache staying between them), NEVER
    // with --keep-loaded (everything accumulates)
    g_pipeline.store            = store_create(g_keep_loaded ? EVICT_NEVER : EVICT_STRICT);
    g_pipeline.transcriber_path = g_transcriber_path;
    if (!pipeline_configure(&g_pipeline, g_model_path.c_str(), g_vae_path.c_str(), params)) {
        store_free(g_pipeline.store);
        return 1;
    }

    std::thread worker(worker_main);

    httplib::Server svr;
    register_comfy_api(svr, comfy_port);
    g_svr = &svr;

    // SO_REUSEADDR lets us rebind a port still in TIME_WAIT after a restart.
    // SO_REUSEPORT is deliberately not set: a second instance on the same port
    // then fails with EADDRINUSE instead of silently sharing the socket and
    // splitting traffic between two daemons.
    svr.set_socket_options([](socket_t sock) {
        int one = 1;
#ifdef _WIN32
        setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (const char *) &one, sizeof(one));
#else
        setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
#endif
    });

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    svr.Get("/health", [](const httplib::Request &, httplib::Response & res) {
        res.set_content(json_string("status", "ok"), "application/json");
    });

    svr.Get("/props", handle_props);

    svr.Get("/logs", handle_logs);

    svr.Post("/synth", [](const httplib::Request & req, httplib::Response & res) {
        Yue2Request request;
        if (!validate(req, res, &request)) {
            return;
        }
        auto job = job_create();
        if (!job) {
            res.status = 429;
            res.set_content(json_string("error", "generation queue full; wait for a job to finish"), "application/json");
            return;
        }
        work_push(job, [job, request] { run_job(job, request); });
        res.set_content(json_string("id", job->id), "application/json");
    });

    // POST /transcribe, multipart/form-data: an "audio" part (WAV or MP3)
    // and an optional "melody_only" field that drops the chord symbols. The
    // route is served when a transcriber is given.
    if (!g_transcriber_path.empty()) {
        svr.Post("/transcribe", [](const httplib::Request & req, httplib::Response & res) {
            if (!req.is_multipart_form_data() || !req.form.has_file("audio")) {
                res.status = 400;
                res.set_content(json_string("error", "multipart audio part required"), "application/json");
                return;
            }
            bool                melody_only = req.form.has_field("melody_only");
            const std::string & file        = req.form.get_file("audio").content;
            int                 T = 0, sr = 0;
            float *             planar = audio_read_buf((const uint8_t *) file.data(), file.size(), &T, &sr);
            std::vector<float>  audio;
            if (!planar || !ss2_mono_24k(planar, T, sr, &audio)) {
                res.status = 400;
                res.set_content(json_string("error", "cannot decode audio"), "application/json");
                return;
            }
            auto job = job_create();
            if (!job) {
                res.status = 429;
                res.set_content(json_string("error", "generation queue full; wait for a job to finish"), "application/json");
                return;
            }
            work_push(job, [job, audio = std::move(audio), melody_only] { run_transcribe(job, audio, melody_only); });
            res.set_content(json_string("id", job->id), "application/json");
        });
    }

    // POST /vocal-balance, multipart/form-data: an audio file and a vocal
    // gain in dB. The original upload is never modified.
    svr.Post("/vocal-balance", [](const httplib::Request & req, httplib::Response & res) {
        if (!req.is_multipart_form_data() || !req.form.has_file("audio") || !req.form.has_field("vocal_gain_db")) {
            res.status = 400;
            res.set_content(json_string("error", "multipart audio and vocal_gain_db fields required"), "application/json");
            return;
        }
        const std::string & file = req.form.get_file("audio").content;
        int samples = 0, sample_rate = 0;
        float * audio = audio_read_buf((const uint8_t *) file.data(), file.size(), &samples, &sample_rate);
        if (!audio || samples <= 0 || sample_rate <= 0) {
            free(audio);
            res.status = 400;
            res.set_content(json_string("error", "cannot decode audio"), "application/json");
            return;
        }
        const std::string gain_text = req.form.get_field("vocal_gain_db");
        char * end = nullptr;
        const float gain = strtof(gain_text.c_str(), &end);
        const bool auto_gain = gain_text == "auto";
        if (!auto_gain && (end == gain_text.c_str() || *end != '\0' || !std::isfinite(gain) || gain < -12.0f || gain > 12.0f)) {
            free(audio);
            res.status = 400;
            res.set_content(json_string("error", "vocal_gain_db must be between -12 and +12"), "application/json");
            return;
        }
        std::vector<float> balanced;
        std::string error;
        float applied_gain = 0.0f;
        const bool ok = audio_vocal_balance_ffmpeg(audio, samples, sample_rate, gain, auto_gain,
                                                   &balanced, &applied_gain, &error);
        free(audio);
        if (!ok) {
            res.status = 503;
            res.set_content(json_string("error", error), "application/json");
            return;
        }
        const std::string wav = audio_encode_wav_f32(balanced.data(), samples, sample_rate);
        if (wav.empty()) {
            res.status = 500;
            res.set_content(json_string("error", "could not encode balanced audio"), "application/json");
            return;
        }
        char applied_gain_text[32];
        snprintf(applied_gain_text, sizeof(applied_gain_text), "%.1f", (double) applied_gain);
        res.set_header("X-Yue2-Vocal-Gain-Db", applied_gain_text);
        res.set_content(wav, "audio/wav");
    });

    svr.Get("/job", [](const httplib::Request & req, httplib::Response & res) {
        auto job = job_find(req.get_param_value("id"));
        if (!job) {
            res.status = 404;
            res.set_content(json_string("error", "job not found"), "application/json");
            return;
        }
        JobStatus status = job->status.load();
        if (!req.has_param("result")) {
            res.set_content(json_string("status", job_status_str(status)), "application/json");
            return;
        }
        if (status != JobStatus::DONE) {
            res.status = 404;
            res.set_content(json_string("error", "result not ready"), "application/json");
            return;
        }
        res.set_content(job->result_body, job->result_mime.c_str());
    });

    svr.Post("/job", [](const httplib::Request & req, httplib::Response & res) {
        auto job = job_find(req.get_param_value("id"));
        if (!job) {
            res.status = 404;
            res.set_content(json_string("error", "job not found"), "application/json");
            return;
        }
        if (req.has_param("cancel")) {
            job->cancel.store(true);
            fprintf(stderr, "[Server] Cancel requested for job %s\n", job->id.c_str());
        }
        res.set_content(json_string("status", job_status_str(job->status.load())), "application/json");
    });

    svr.Get("/", [](const httplib::Request & req, httplib::Response & res) {
        if (req.get_header_value("Accept-Encoding").find("gzip") == std::string::npos) {
            res.status = 406;
            res.set_content("gzip required", "text/plain");
            return;
        }
        res.set_header("Content-Encoding", "gzip");
        res.set_content(std::string((const char *) index_html_gz, index_html_gz_len), "text/html");
    });

    fprintf(stderr, "[Server] yue-server %s\n", YUE2_VERSION);
    fprintf(stderr, "[Server] Listening on %s:%d\n", host, port);
    // A failed bind must reach the caller: a supervisor that reads only the
    // exit code would otherwise believe the daemon is up.
    int exit_code = 0;
    if (!svr.listen(host, port)) {
        fprintf(stderr, "[Server] FATAL: cannot bind %s:%d\n", host, port);
        exit_code = 1;
    }

    {
        std::lock_guard<std::mutex> lock(mtx_work);
        g_work_stop = true;
    }
    {
        std::lock_guard<std::mutex> lock(mtx_jobs);
        for (const auto & entry : g_jobs) entry.second->cancel.store(true);
    }
    cv_work.notify_all();
    worker.join();
    pipeline_free(&g_pipeline);
    store_free(g_pipeline.store);
    fprintf(stderr, "[Server] Done\n");
    return exit_code;
}
