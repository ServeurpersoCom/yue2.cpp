#pragma once
#include <filesystem>
#include <fstream>
#include <string>
#include <chrono>
#include <stdexcept>

// Immutable terminal records: atomic rename publishes metadata and audio together.
// Unacknowledged results are never automatically removed. Acknowledged results
// remain recoverable for 30 days. In-flight native computation cannot resume;
// its pending marker becomes an explicit interrupted status after restart.
namespace job_archive {
namespace fs = std::filesystem;
inline bool valid_id(const std::string & id) {
 if (id.size() != 16 && id.size() != 32) return false;
 return id.find_first_not_of("0123456789abcdef") == std::string::npos;
}
inline fs::path root() { return fs::absolute("job_results"); }
inline fs::path path(const std::string & id, const char * suffix) {
 if (!valid_id(id)) throw std::runtime_error("Invalid job ID");
 return root() / (id + suffix);
}
inline void start(const std::string & id) {
 fs::create_directories(root());
 uintmax_t bytes=0;
 for(const auto &entry:fs::directory_iterator(root()))if(entry.is_regular_file())bytes+=entry.file_size();
 if(bytes>16ULL*1024*1024*1024)throw std::runtime_error("Job recovery storage exceeds 16 GiB. Back up saved tracks and review job_results before starting more work.");
 if(fs::space(root()).available<512ULL*1024*1024)throw std::runtime_error("Less than 512 MiB disk space remains. Free space before generating more media.");
 std::ofstream out(path(id,".pending"), std::ios::binary);
 out << "interrupted\n"; out.flush();
 if (!out) throw std::runtime_error("Cannot save job recovery record; check disk space and permissions");
}
inline void finish(const std::string & id, int status, const std::string & mime, const std::string & body) {
 fs::create_directories(root());
 const auto temp = path(id,".tmp"), result = path(id,".result");
 if (fs::exists(result)) return;
 {
  std::ofstream out(temp,std::ios::binary | std::ios::trunc);
  out << "YUE2JOB1\n" << status << '\n' << mime.size() << '\n' << body.size() << '\n';
  out.write(mime.data(), (std::streamsize)mime.size());
  out.write(body.data(), (std::streamsize)body.size()); out.flush();
  if (!out) throw std::runtime_error("Cannot save completed job; disk full or unavailable");
 }
 fs::rename(temp,result);
 std::error_code error; fs::remove(path(id,".pending"),error);
}
inline bool read(const std::string & id, int & status, std::string & mime, std::string & body, bool include_body) {
 if (!valid_id(id)) return false;
 std::ifstream in(path(id,".result"),std::ios::binary);
 if (!in) { if (fs::exists(path(id,".pending"))) { status = 4; return true; } return false; }
 std::string magic; std::getline(in,magic);
 uint64_t mime_size = 0, body_size = 0;
 in >> status >> mime_size >> body_size; in.get();
 if (!in || magic != "YUE2JOB1" || status < 1 || status > 3 || mime_size > 4096) throw std::runtime_error("Corrupt archived job metadata");
 const auto offset = in.tellg();
 const uint64_t size = fs::file_size(path(id,".result"));
 if (offset < 0 || (uint64_t)offset > size || mime_size > size - (uint64_t)offset || body_size != size - (uint64_t)offset - mime_size) throw std::runtime_error("Incomplete archived job");
 mime.resize((size_t)mime_size); in.read(mime.data(), (std::streamsize)mime_size);
 if (include_body) { body.resize((size_t)body_size); in.read(body.data(), (std::streamsize)body_size); }
 if (!in) throw std::runtime_error("Cannot read archived job");
 return true;
}
inline void acknowledge(const std::string & id) {
 if (!fs::exists(path(id,".result"))) return;
 std::ofstream out(path(id,".ack")); out << "saved to library\n"; out.flush();
 if (!out) throw std::runtime_error("Cannot record result acknowledgement");
}
inline void cleanup() {
 if (!fs::exists(root())) return;
 for (const auto & entry : fs::directory_iterator(root())) {
  if (entry.path().extension() != ".ack" || !valid_id(entry.path().stem().string())) continue;
  if (fs::file_time_type::clock::now() - entry.last_write_time() < std::chrono::hours(24 * 30)) continue;
  const auto id = entry.path().stem().string();
  for (const char * suffix : {".result", ".pending", ".tmp", ".ack"}) { std::error_code error; fs::remove(path(id,suffix),error); }
 }
}
}
