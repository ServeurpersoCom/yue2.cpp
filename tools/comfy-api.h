#pragma once
#include "httplib.h"
#include <functional>
#include <mutex>

// Narrow loopback-only bridge: no arbitrary destinations or manager endpoints.
static void register_comfy_api(httplib::Server & server, int port, std::function<bool()> busy = {}, std::timed_mutex * gate = nullptr) {
    auto forward = [port,busy,gate](const httplib::Request & req, httplib::Response & res) {
        std::unique_lock<std::timed_mutex> ownership;
        if(req.target=="/comfy/prompt" && gate) {ownership=std::unique_lock<std::timed_mutex>(*gate,std::try_to_lock);if(!ownership.owns_lock()){res.status=409;res.set_content("Studio is using the GPU; retry when it finishes.","text/plain");return;}}
        if(req.target=="/comfy/prompt" && busy && busy()) {res.status=409;res.set_content("Studio is using the GPU. Wait for the current operation to finish.","text/plain");return;}
        if (req.body.size() > 24 * 1024 * 1024) { res.status = 413; res.set_content("Artwork request too large", "text/plain"); return; }
        httplib::Client client("127.0.0.1", port);
        client.set_connection_timeout(3);
        client.set_read_timeout(30);
        client.set_write_timeout(30);
        const std::string target = req.target.substr(6);
        httplib::UploadFormDataItems items;
        size_t size=req.body.size();
        for(const auto &entry:req.form.fields){const auto &v=entry.second;items.push_back({v.name,v.content,"",""});size+=v.content.size();}
        for(const auto &entry:req.form.files){const auto &v=entry.second;items.push_back({v.name,v.content,v.filename,v.content_type});size+=v.content.size();}
        if(size>24*1024*1024){res.status=413;return;}
        auto result = req.method == "GET" ? client.Get(target) : req.is_multipart_form_data() ? client.Post(target,items) : client.Post(target, req.body, req.get_header_value("Content-Type"));
        if (!result) { res.status = 503; res.set_content("ComfyUI is unavailable. Start the configured ComfyUI app and check artwork readiness.", "text/plain"); return; }
        res.status = result->status;
        res.set_content(result->body, result->get_header_value("Content-Type"));
    };
    server.Get(R"(/comfy/(object_info|queue|history/[a-zA-Z0-9-]+|view))", forward);
    server.Post(R"(/comfy/(prompt|upload/image|free))", forward);
}
