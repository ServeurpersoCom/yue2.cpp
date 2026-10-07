#pragma once
#include "httplib.h"
#include <mutex>
#include <thread>
#include <chrono>
#ifdef _WIN32
#include <process.h>
#else
#include <spawn.h>
#include <sys/wait.h>
extern char ** environ;
#endif

static void register_youtube_api(httplib::Server &server) {
 auto mutex=std::make_shared<std::mutex>();
 auto forward=[mutex](const httplib::Request &req,httplib::Response &res){
  const auto origin=req.get_header_value("Origin");if((!origin.empty() && origin!="http://"+req.get_header_value("Host")) || req.get_header_value("Sec-Fetch-Site")=="cross-site"){res.status=403;return;}
  if(req.body.size()>270ULL*1024*1024){res.status=413;return;}
  httplib::Client client("127.0.0.1",18189);client.set_connection_timeout(1);client.set_read_timeout(30);client.set_write_timeout(30);
  auto status=client.Get("/status");
  if(!status&&req.target=="/youtube/launch"){
   std::lock_guard<std::mutex> lock(*mutex);
   status=client.Get("/status");
   if(!status){
#ifdef _WIN32
    const char *args[]={"node","tools/youtube-agent/bridge.mjs",nullptr};
    const auto child=_spawnvp(_P_NOWAIT,"node",args);if(child!=-1)CloseHandle((HANDLE)child);
#else
    char node[]="node",script[]="tools/youtube-agent/bridge.mjs";char *args[]={node,script,nullptr};pid_t pid;
    if(posix_spawnp(&pid,"node",nullptr,nullptr,args,environ)==0)std::thread([pid]{int result;waitpid(pid,&result,0);}).detach();
#endif
    for(int i=0;i<30&&!status;i++){std::this_thread::sleep_for(std::chrono::milliseconds(100));status=client.Get("/status");}
   }
  }
  if(!status){if(req.method=="POST")res.status=503;res.set_content("{\"status\":\"offline\",\"message\":\"Start an upload session to launch the agent.\"}","application/json");return;}
  httplib::UploadFormDataItems items;size_t size=req.body.size();
  for(const auto &entry:req.form.fields){const auto &v=entry.second;items.push_back({v.name,v.content,"",""});size+=v.content.size();}
  for(const auto &entry:req.form.files){const auto &v=entry.second;items.push_back({v.name,v.content,v.filename,v.content_type});size+=v.content.size();}
  if(size>270ULL*1024*1024){res.status=413;return;}
  auto response=req.method=="GET"?std::move(status):req.is_multipart_form_data()?client.Post(req.target.substr(8),items):client.Post(req.target.substr(8),req.body,req.get_header_value("Content-Type"));
  if(!response){res.status=503;return;}res.status=response->status;res.set_content(response->body,"application/json");
 };
 server.Get("/youtube/status",forward);
 server.Post(R"(/youtube/(launch|continue|stop))",forward);
}
