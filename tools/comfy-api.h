#pragma once
#include "httplib.h"

// Narrow loopback-only bridge: no arbitrary destinations or manager endpoints.
static void register_comfy_api(httplib::Server & server, int port) {
    auto forward = [port](const httplib::Request & req, httplib::Response & res) {
        if (req.body.size() > 24 * 1024 * 1024) { res.status = 413; res.set_content("Artwork request too large", "text/plain"); return; }
        httplib::Client client("127.0.0.1", port);
        client.set_connection_timeout(3);
        client.set_read_timeout(30);
        client.set_write_timeout(30);
        const std::string target = req.target.substr(6);
        auto result = req.method == "GET" ? client.Get(target) : client.Post(target, req.body, req.get_header_value("Content-Type"));
        if (!result) { res.status = 503; res.set_content("ComfyUI is unavailable. Start the configured ComfyUI app and check artwork readiness.", "text/plain"); return; }
        res.status = result->status;
        res.set_content(result->body, result->get_header_value("Content-Type"));
    };
    server.Get(R"(/comfy/(object_info|queue|history/[a-zA-Z0-9-]+|view))", forward);
    server.Post(R"(/comfy/(prompt|upload/image|free))", forward);
}
