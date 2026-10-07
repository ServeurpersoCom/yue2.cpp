#pragma once
#include "httplib.h"
#include "yyjson.h"
#include <filesystem>
#include <fstream>
#include <mutex>
#include <memory>

inline void register_saved_presets(httplib::Server & server) {
    namespace fs = std::filesystem;
    const auto folder = fs::absolute("saved_presets");
    // Reconcile an interrupted replacement before listing or accepting writes.
    fs::create_directories(folder);
    for (const auto & entry : fs::directory_iterator(folder)) {
        if (fs::is_symlink(entry.path())) continue;
        const auto ext=entry.path().extension();
        if (ext != ".bak" && ext != ".tmp") continue;
        auto final=entry.path(); final.replace_extension(".json");
        if (ext == ".bak" && !fs::exists(final)) fs::rename(entry.path(),final);
        else fs::remove(entry.path());
    }
    auto mutex = std::make_shared<std::mutex>();
    server.Get("/presets", [folder, mutex](const httplib::Request &, httplib::Response & res) {
        std::lock_guard<std::mutex> lock(*mutex);
        try {
            fs::create_directories(folder);
            std::string body = "[";
            for (const auto & file : fs::directory_iterator(folder)) {
                if (!file.is_regular_file() || file.path().extension() != ".json" || fs::is_symlink(file.path())) continue;
                std::ifstream input(file.path(), std::ios::binary);
                std::string value((std::istreambuf_iterator<char>(input)), {});
                auto * doc = yyjson_read(value.data(), value.size(), 0);
                if (!doc) continue;
                auto * root = yyjson_doc_get_root(doc);
                const bool valid = yyjson_is_obj(root) && yyjson_is_str(yyjson_obj_get(root,"name")) && yyjson_is_str(yyjson_obj_get(root,"kind")) && yyjson_is_obj(yyjson_obj_get(root,"data"));
                if (valid) {
                    // Filename is authoritative after atomic rename.
                    auto mutable_doc=yyjson_doc_mut_copy(doc,nullptr);
                    auto mutable_root=yyjson_mut_doc_get_root(mutable_doc);
                    const auto stem=file.path().stem().u8string();
                    const auto dash=stem.find('-');
                    const auto name=stem.substr(dash+1);
                    yyjson_mut_obj_put(mutable_root,yyjson_mut_strcpy(mutable_doc,"name"),yyjson_mut_strcpy(mutable_doc,name.c_str()));
                    char * encoded=yyjson_mut_write(mutable_doc,0,nullptr);
                    if(encoded) { value=encoded; free(encoded); }
                    yyjson_mut_doc_free(mutable_doc);
                }
                yyjson_doc_free(doc);
                if (valid) { if (body.size() > 1) body += ','; body += value; }
            }
            res.set_content(body + "]", "application/json");
        } catch (...) { res.status = 500; res.set_content("Could not read saved_presets folder", "text/plain"); }
    });
    server.Post("/presets", [folder, mutex](const httplib::Request & req, httplib::Response & res) {
        std::lock_guard<std::mutex> lock(*mutex);
        if (req.get_header_value("Content-Type").find("application/json") != 0 || req.body.size() > 262144) { res.status = 400; return; }
        auto * doc = yyjson_read(req.body.data(), req.body.size(), 0);
        if (!doc) { res.status = 400; return; }
        auto * root = yyjson_doc_get_root(doc);
        auto str = [&](const char * key) { const char * s = yyjson_get_str(yyjson_obj_get(root,key)); return std::string(s ? s : ""); };
        const auto name = str("name"), kind = str("kind"), operation = str("operation");
        auto * data = yyjson_obj_get(root,"data");
        const bool overwrite = yyjson_get_bool(yyjson_obj_get(root,"overwrite"));
        bool valid = !name.empty() && name.size() <= 200 && name.back() != '.' && name.back() != ' ' && (kind == "music" || kind == "lyric" || kind == "studio") && (operation == "save" || operation == "delete" || operation == "rename");
        for (unsigned char c : name) if (c < 32 || std::string("<>:\"/\\|?*").find(c) != std::string::npos) valid = false;
        if (operation == "save" && (!yyjson_is_obj(data) || !yyjson_is_arr(yyjson_obj_get(data,"ids")) || !yyjson_is_obj(yyjson_obj_get(data,"weights")))) valid = false;
        if (!valid) { yyjson_doc_free(doc); res.status = 400; res.set_content("Use a preset name without filename characters or trailing dots/spaces.","text/plain"); return; }
        try {
            fs::create_directories(folder);
            const auto file = folder / fs::u8path(kind + "-" + name + ".json");
            if (fs::is_symlink(file)) throw std::runtime_error("Invalid preset file");
            if (operation == "rename") {
                const auto old_name=str("oldName");
                bool safe=!old_name.empty() && old_name.size()<=200 && old_name.back()!='.' && old_name.back()!=' ';
                for(unsigned char c:old_name) if(c<32 || std::string("<>:\\\"/\\\\|?*").find(c)!=std::string::npos) safe=false;
                if(!safe) throw std::runtime_error("Invalid original preset name");
                const auto source=folder / fs::u8path(kind+"-"+old_name+".json");
                if(fs::is_symlink(source) || !fs::exists(source)) throw std::runtime_error("Original preset no longer exists");
                if(fs::exists(file)) { res.status=409; res.set_content("Preset name already exists","text/plain"); yyjson_doc_free(doc); return; }
                fs::rename(source,file);
            }
            else if (operation == "delete") fs::remove(file);
            else if (fs::exists(file) && !overwrite) { res.status = 409; res.set_content("A preset with that name already exists.","text/plain"); yyjson_doc_free(doc); return; }
            else {
                const auto temp = folder / fs::u8path(kind + "-" + name + ".tmp");
                const auto backup = folder / fs::u8path(kind + "-" + name + ".bak");
                if (fs::is_symlink(temp) || fs::exists(backup)) throw std::runtime_error("Preset has a pending recovery file");
                { std::ofstream out(temp, std::ios::binary | std::ios::trunc); out << req.body; out.flush(); if (!out) throw std::runtime_error("Could not write preset"); }
                const bool existed = fs::exists(file);
                if (existed) fs::rename(file, backup);
                try { fs::rename(temp, file); } catch (...) { if (existed) fs::rename(backup,file); throw; }
                if (existed) fs::remove(backup);
            }
            res.set_content("{\"ok\":true}","application/json");
        } catch (const std::exception & e) { res.status = 500; res.set_content(e.what(),"text/plain"); }
        yyjson_doc_free(doc);
    });
}
