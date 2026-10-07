#include "job-archive.h"
#include <iostream>

static void check(bool value, const char * message) { if (!value) throw std::runtime_error(message); }
int main() {
 namespace fs = std::filesystem;
 const auto sandbox = fs::absolute("build/job-archive-tests/work-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
 fs::create_directories(sandbox); fs::current_path(sandbox);
 const std::string id = "0123456789abcdef0123456789abcdef";
 check(!job_archive::valid_id("../invalid"),"invalid IDs accepted");
 job_archive::start(id);
 int status = 0; std::string mime,body;
 check(job_archive::read(id,status,mime,body,false) && status == 4,"pending jobs must recover as interrupted");
 const std::string original("binary\0audio",12);
 job_archive::finish(id,1,"audio/wav",original);
 check(job_archive::read(id,status,mime,body,false) && status == 1 && body.empty(),"metadata polling must not load audio");
 check(job_archive::read(id,status,mime,body,true) && body == original && mime == "audio/wav","archived binary mismatch");
 job_archive::finish(id,2,"", "different");
 check(job_archive::read(id,status,mime,body,true) && status == 1 && body == original,"terminal records must be immutable");
 job_archive::cleanup(); check(fs::exists(job_archive::path(id,".result")),"unacknowledged result removed");
 job_archive::acknowledge(id);
 fs::last_write_time(job_archive::path(id,".ack"),fs::file_time_type::clock::now()-std::chrono::hours(24*31));
 job_archive::cleanup(); check(!fs::exists(job_archive::path(id,".result")),"expired acknowledged result retained");
 std::cout << "PASS: pending restart, binary persistence, metadata-only polling, idempotence, acknowledgement retention, safe IDs\n";
}
