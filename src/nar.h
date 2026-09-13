// nar.h : NAR flow matching path of the MoT backbone (GGML)
//
// The NAR half carries its own complete parameter set per layer and shares the
// embeddings, the final norm and RoPE with the AR half. It predicts the
// velocity field of the acoustic latents. It holds nothing of the AR half:
// it loads the shared norm itself and reads the KV cache through a handle,
// so the AR weights may leave VRAM before it runs.
//
// Attention: NAR queries see the AR prefix in full and each other
// bidirectionally, AR positions never see the NAR ones. The AR prefix is
// exactly the KV cache the AR pass already filled, so the reference
// cat(ar_k, nar_k) is the contiguous cache window [0, ar_len + N_nar) and the
// attention runs unmasked.
//
// Positions: the NAR block continues the AR RoPE positions, and carries a
// second non-learnable sinusoidal embedding over its own frame index.
// The latent sequence is LATENT_START, T_lat content frames, LATENT_END, with
// clean zeros at both ends.
//
// Variations: M noise draws of the same block solve in one graph, the AR
// prefix rows repeated for each, the frame inputs shared.
#pragma once

#include "debug.h"
#include "qwen3-lm.h"
#include "timer.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#define YUE2_NAR_GRAPH_NODES 8192
#define YUE2_TIME_EMBED_DIM  256
#define YUE2_NAR_MASK_PAD    64

// Named probes of the velocity graph, read by the cossim harness: the key
// depths of the latent block and the layer 0 attention output
#define YUE2_NAR_PROBE_LAYERS { 0, 7, 14, 21, 27 }

struct Yue2NAR {
    Qwen3LMConfig cfg;  // the backbone config, shared with the AR half
    bool          use_flash_attn;
    bool          clamp_fp16;

    int   latent_dim;
    float timestep_shift;

    Qwen3Layer           layers[QW3LM_MAX_LAYERS];  // nar_* weight set
    struct ggml_tensor * final_norm;                // [H], the norm both halves end with
    struct ggml_tensor * vae2llm_w, *vae2llm_b;     // [latent_dim, H], [H]
    struct ggml_tensor * llm2vae_w, *llm2vae_b;     // [H, latent_dim], [latent_dim]
    struct ggml_tensor * time_w0, *time_b0;         // [256, H], [H]
    struct ggml_tensor * time_w1, *time_b1;         // [H, H], [H]

    WeightCtx             wctx;
    struct ggml_context * input_ctx;  // shape-constant inputs, outside the graph allocation
    ggml_backend_buffer_t input_buf;
    ggml_backend_t        backend;
    ggml_backend_t        cpu_backend;
    ggml_backend_sched_t  sched;

    // Graph cache: the ODE replays one shape for every one of its evaluations
    GraphArena           arena;       // stable node addresses across rebuilds
    struct ggml_cgraph * graph;
    struct ggml_tensor * in_x;        // [latent_dim, N_nar, M]
    struct ggml_tensor * in_time;     // [256]
    struct ggml_tensor * in_pos_emb;  // [H, N_nar]
    struct ggml_tensor * in_pos;      // [N_nar] i32
    struct ggml_tensor * in_mask;     // [ar_len + N_nar, pad(N_nar)] f16, all zero
    struct ggml_tensor * out_v;       // [latent_dim, T_lat, M]
    int                  graph_T;     // cached T_lat (0 = no cache)
    int                  graph_M;     // cached variation count
    int                  graph_ar;    // cached ar_len
    int                  graph_set;   // cached KV set

    std::vector<float>   scratch_x;
    std::vector<float>   scratch_pos_emb;
    std::vector<int32_t> scratch_pos;
};

// Load the nar_* weight set of one layer, mirroring qwen3_load_layer
static void nar_load_layer(WeightCtx *         wctx,
                           const GGUFModel &   gf,
                           Qwen3Layer *        ly,
                           const std::string & prefix,
                           int                 layer_idx = -1) {
    ly->input_layernorm     = gf_load_tensor_f32(wctx, gf, prefix + ".nar_input_layernorm.weight");
    ly->post_attn_layernorm = gf_load_tensor_f32(wctx, gf, prefix + ".nar_pre_mlp_layernorm.weight");

    ly->qkv = gf_load_qkv_fused(wctx, gf, prefix + ".nar_self_attn.q_proj.weight",
                                prefix + ".nar_self_attn.k_proj.weight", prefix + ".nar_self_attn.v_proj.weight");
    if (!ly->qkv) {
        ly->q_proj = gf_load_tensor(wctx, gf, prefix + ".nar_self_attn.q_proj.weight");
        ly->k_proj = gf_load_tensor(wctx, gf, prefix + ".nar_self_attn.k_proj.weight");
        ly->v_proj = gf_load_tensor(wctx, gf, prefix + ".nar_self_attn.v_proj.weight");
        if (layer_idx == 0) {
            fprintf(stderr, "[NAR] Attn: all separate\n");
        }
    } else if (layer_idx == 0) {
        fprintf(stderr, "[NAR] Attn: Q+K+V fused\n");
    }

    ly->o_proj = gf_load_tensor(wctx, gf, prefix + ".nar_self_attn.o_proj.weight");
    ly->q_norm = gf_load_tensor_f32(wctx, gf, prefix + ".nar_self_attn.q_norm.weight");
    ly->k_norm = gf_load_tensor_f32(wctx, gf, prefix + ".nar_self_attn.k_norm.weight");

    ly->gate_up =
        gf_load_pair_fused(wctx, gf, prefix + ".nar_mlp.gate_proj.weight", prefix + ".nar_mlp.up_proj.weight");
    if (!ly->gate_up) {
        ly->gate_proj = gf_load_tensor(wctx, gf, prefix + ".nar_mlp.gate_proj.weight");
        ly->up_proj   = gf_load_tensor(wctx, gf, prefix + ".nar_mlp.up_proj.weight");
        if (layer_idx == 0) {
            fprintf(stderr, "[NAR] MLP: gate+up separate\n");
        }
    } else if (layer_idx == 0) {
        fprintf(stderr, "[NAR] MLP: gate+up fused\n");
    }
    ly->down_proj = gf_load_tensor(wctx, gf, prefix + ".nar_mlp.down_proj.weight");
}

static bool nar_load(Yue2NAR * n, const char * gguf_path) {
    *n = {};

    GGUFModel gf = {};
    if (!gf_load(&gf, gguf_path)) {
        fprintf(stderr, "[NAR] FATAL: cannot load %s\n", gguf_path);
        return false;
    }

    n->cfg            = qw3lm_load_config(gf);
    n->latent_dim     = qw3lm_json_int(gf_get_str(gf, "yue2.config_json"), "latent_dim", 64);
    n->timestep_shift = qw3lm_json_float(gf_get_str(gf, "yue2.config_json"), "timestep_shift", 1.0f);

    BackendPair bp    = backend_init("NAR");
    n->backend        = bp.backend;
    n->cpu_backend    = bp.cpu_backend;
    n->sched          = backend_sched_new(bp, YUE2_NAR_GRAPH_NODES);
    n->use_flash_attn = bp.has_gpu;

    // layers * 11 + vae2llm(2) + llm2vae(2) + time embedder(4)
    if (!graph_arena_init(&n->arena, YUE2_NAR_GRAPH_NODES)) {
        gf_close(&gf);
        return false;
    }

    wctx_init(&n->wctx, 9 + n->cfg.n_layers * 11);

    for (int l = 0; l < n->cfg.n_layers; l++) {
        nar_load_layer(&n->wctx, gf, &n->layers[l], "model.layers." + std::to_string(l), l);
    }
    n->final_norm = gf_load_tensor_f32(&n->wctx, gf, "model.norm.weight");
    n->vae2llm_w  = gf_load_tensor(&n->wctx, gf, "vae2llm.weight");
    n->vae2llm_b  = gf_load_tensor_f32(&n->wctx, gf, "vae2llm.bias");
    n->llm2vae_w  = gf_load_tensor(&n->wctx, gf, "llm2vae.weight");
    n->llm2vae_b  = gf_load_tensor_f32(&n->wctx, gf, "llm2vae.bias");
    n->time_w0    = gf_load_tensor(&n->wctx, gf, "time_embedder.mlp.0.weight");
    n->time_b0    = gf_load_tensor_f32(&n->wctx, gf, "time_embedder.mlp.0.bias");
    n->time_w1    = gf_load_tensor(&n->wctx, gf, "time_embedder.mlp.2.weight");
    n->time_b1    = gf_load_tensor_f32(&n->wctx, gf, "time_embedder.mlp.2.bias");

    if (!wctx_alloc(&n->wctx, n->backend)) {
        fprintf(stderr, "[NAR] FATAL: failed to allocate weights\n");
        gf_close(&gf);
        return false;
    }
    gf_close(&gf);
    fprintf(stderr, "[NAR] Loaded: %d layers, latent_dim=%d, timestep_shift=%.3f\n", n->cfg.n_layers, n->latent_dim,
            n->timestep_shift);
    return true;
}

// Sigmoid of the raw timestep, then the release shift curve
static float nar_shift_t(const Yue2NAR * n, float raw_t) {
    float s   = n->timestep_shift;
    float sig = 1.0f / (1.0f + expf(-raw_t));
    return s * sig / (1.0f + (s - 1.0f) * sig);
}

// Sinusoidal timestep features, cosine half first
static void nar_time_features(float t, float * out) {
    int half = YUE2_TIME_EMBED_DIM / 2;
    for (int i = 0; i < half; i++) {
        float freq    = expf(-logf(10000.0f) * (float) i / (float) half);
        out[i]        = cosf(t * freq);
        out[half + i] = sinf(t * freq);
    }
}

// Non-learnable sinusoidal frame embedding, interleaved sin/cos over H
static void nar_pos_features(int N, int H, float * out) {
    for (int p = 0; p < N; p++) {
        for (int i = 0; i * 2 < H; i++) {
            float div              = expf((float) (2 * i) * (-logf(10000.0f) / (float) H));
            out[p * H + 2 * i]     = sinf((float) p * div);
            out[p * H + 2 * i + 1] = cosf((float) p * div);
        }
    }
}

// Raw timestep of the reference schedule: the logit of t, saturated
static float nar_logit_clamped(float t) {
    if (t >= 1.0f) {
        return 20.0f;
    }
    if (t <= 0.0f) {
        return -20.0f;
    }
    float v = logf(t / (1.0f - t));
    return v > 20.0f ? 20.0f : (v < -20.0f ? -20.0f : v);
}

static struct ggml_tensor * nar_linear_bias(struct ggml_context * ctx,
                                            struct ggml_tensor *  w,
                                            struct ggml_tensor *  b,
                                            struct ggml_tensor *  x) {
    return ggml_add(ctx, ggml_mul_mat(ctx, w, x), b);
}

// NAR attention: fresh Q/K/V for the latent block of every variation,
// concatenated with the AR prefix window of the cache, which every variation
// reads. The graph only reads the cache, so there is no write to order against
// the read and the hazard cannot exist.
static struct ggml_tensor * nar_build_attn(struct ggml_context * ctx,
                                           const Qwen3LMConfig & c,
                                           Qwen3Layer *          ly,
                                           struct ggml_tensor *  x,          // [H, N, M]
                                           struct ggml_tensor *  positions,  // [N]
                                           struct ggml_tensor *  mask,       // [ar_len + N, pad(N)] f16, all zero
                                           struct ggml_tensor *  cache_k,    // [D, max_seq, Nkv] f16
                                           struct ggml_tensor *  cache_v,
                                           int                   ar_len,
                                           int                   N,
                                           int                   M,
                                           bool                  use_flash_attn,
                                           bool                  clamp_fp16) {
    int D   = c.head_dim;
    int Nh  = c.n_heads;
    int Nkv = c.n_kv_heads;

    struct ggml_tensor *q, *k, *v;
    int                 q_dim  = Nh * D;
    int                 kv_dim = Nkv * D;
    if (ly->qkv) {
        struct ggml_tensor * qkv = qwen3_linear(ctx, ly->qkv, x);
        q                        = ggml_cont(ctx, ggml_view_3d(ctx, qkv, q_dim, N, M, qkv->nb[1], qkv->nb[2], 0));
        k = ggml_cont(ctx, ggml_view_3d(ctx, qkv, kv_dim, N, M, qkv->nb[1], qkv->nb[2], (size_t) q_dim * qkv->nb[0]));
        v = ggml_cont(
            ctx, ggml_view_3d(ctx, qkv, kv_dim, N, M, qkv->nb[1], qkv->nb[2], (size_t) (q_dim + kv_dim) * qkv->nb[0]));
    } else {
        q = qwen3_linear(ctx, ly->q_proj, x);
        k = qwen3_linear(ctx, ly->k_proj, x);
        v = qwen3_linear(ctx, ly->v_proj, x);
    }

    q = ggml_reshape_4d(ctx, q, D, Nh, N, M);
    k = ggml_reshape_4d(ctx, k, D, Nkv, N, M);
    v = ggml_reshape_4d(ctx, v, D, Nkv, N, M);

    q = ggml_rms_norm(ctx, q, c.rms_norm_eps);
    q = ggml_mul(ctx, q, qwen3_f32(ctx, ly->q_norm));
    k = ggml_rms_norm(ctx, k, c.rms_norm_eps);
    k = ggml_mul(ctx, k, qwen3_f32(ctx, ly->k_norm));

    q = ggml_rope_ext(ctx, q, positions, NULL, D, 2, 0, c.rope_theta, 1.0f, 0.0f, 1.0f, 0.0f, 0.0f);
    k = ggml_rope_ext(ctx, k, positions, NULL, D, 2, 0, c.rope_theta, 1.0f, 0.0f, 1.0f, 0.0f, 0.0f);

    q = ggml_cont(ctx, ggml_permute(ctx, q, 0, 2, 1, 3));  // [D, N, Nh, M]
    k = ggml_cont(ctx, ggml_permute(ctx, k, 0, 2, 1, 3));  // [D, N, Nkv, M]
    v = ggml_cont(ctx, ggml_permute(ctx, v, 0, 2, 1, 3));

    // Clamp V before the F16 cast: the clamp kernels walk contiguous memory
    if (clamp_fp16) {
        v = ggml_clamp(ctx, v, -65504.0f, 65504.0f);
    }
    k = ggml_cast(ctx, k, GGML_TYPE_F16);
    v = ggml_cast(ctx, v, GGML_TYPE_F16);

    // AR prefix rows in the f16 layout of the cache, repeated per variation
    struct ggml_tensor * k_ar =
        ggml_cont(ctx, ggml_view_3d(ctx, cache_k, D, ar_len, Nkv, cache_k->nb[1], cache_k->nb[2], 0));
    struct ggml_tensor * v_ar =
        ggml_cont(ctx, ggml_view_3d(ctx, cache_v, D, ar_len, Nkv, cache_v->nb[1], cache_v->nb[2], 0));
    if (M > 1) {
        struct ggml_tensor * shape = ggml_new_tensor_4d(ctx, GGML_TYPE_F16, D, ar_len, Nkv, M);
        k_ar                       = ggml_repeat(ctx, k_ar, shape);
        v_ar                       = ggml_repeat(ctx, v_ar, shape);
    }

    struct ggml_tensor * k_full = ggml_concat(ctx, k_ar, k, 1);
    struct ggml_tensor * v_full = ggml_concat(ctx, v_ar, v, 1);

    float                scale = 1.0f / sqrtf((float) D);
    struct ggml_tensor * attn  = use_flash_attn ? ggml_flash_attn_ext(ctx, q, k_full, v_full, mask, scale, 0.0f, 0.0f) :
                                                  qwen3_attn_f32(ctx, q, k_full, v_full, mask, scale);
    if (use_flash_attn) {
        ggml_prec_set_acc(attn, GGML_PREC_F32);
    }

    attn = ggml_reshape_3d(ctx, attn, Nh * D, N, M);
    return qwen3_linear(ctx, ly->o_proj, attn);
}

// Build the velocity graph of M variations of a T_lat frame block over the
// AR prefix of KV set kv_set. The frame inputs hold for a shape (T_lat,
// ar_len), the graph itself is rebuilt at every evaluation.
static bool nar_build_graph(Yue2NAR * n, const Qw3lmKvCache * kv, int T_lat, int M, int ar_len, int kv_set) {
    bool                  new_shape = (n->graph_T != T_lat || n->graph_ar != ar_len);
    bool                  new_key   = new_shape || n->graph_M != M || n->graph_set != kv_set;
    const Qwen3LMConfig & c         = n->cfg;
    int                   H         = c.hidden_size;
    int                   N         = T_lat + 2;

    if (ar_len < 1 || ar_len + N > kv->cfg.max_seq_len) {
        fprintf(stderr, "[NAR] FATAL: prefix %d plus latent block %d exceeds the context %d\n", ar_len, N,
                kv->cfg.max_seq_len);
        return false;
    }
    // Rewinding the arena rebuilds every node at the address it already had,
    // so the backend graph cache resolves to the same executable at every
    // evaluation of the ODE instead of thrashing on fresh allocations.
    ggml_backend_sched_reset(n->sched);
    struct ggml_context * ctx = graph_arena_begin(&n->arena);
    struct ggml_cgraph *  gf  = ggml_new_graph_custom(ctx, YUE2_NAR_GRAPH_NODES, false);

    n->in_x = ggml_new_tensor_3d(ctx, GGML_TYPE_F32, n->latent_dim, N, M);
    ggml_set_name(n->in_x, "nar_x");
    ggml_set_input(n->in_x);
    n->in_time = ggml_new_tensor_1d(ctx, GGML_TYPE_F32, YUE2_TIME_EMBED_DIM);
    ggml_set_name(n->in_time, "nar_time");
    ggml_set_input(n->in_time);
    // Frame embedding and index tensors hold for the whole ODE: they live in
    // their own buffer, so the graph allocation of each evaluation leaves them
    // in place and they are uploaded once per shape.
    if (new_shape) {
        if (n->input_ctx) {
            ggml_backend_buffer_free(n->input_buf);
            ggml_free(n->input_ctx);
        }
        struct ggml_init_params ip = { ggml_tensor_overhead() * 8, NULL, true };
        n->input_ctx               = ggml_init(ip);
        n->in_pos_emb              = ggml_new_tensor_2d(n->input_ctx, GGML_TYPE_F32, H, N);
        n->in_pos                  = ggml_new_tensor_1d(n->input_ctx, GGML_TYPE_I32, N);
        int mask_rows              = (N + YUE2_NAR_MASK_PAD - 1) / YUE2_NAR_MASK_PAD * YUE2_NAR_MASK_PAD;
        n->in_mask                 = ggml_new_tensor_2d(n->input_ctx, GGML_TYPE_F16, ar_len + N, mask_rows);
        ggml_set_name(n->in_pos_emb, "nar_pos_emb");
        ggml_set_input(n->in_pos_emb);
        ggml_set_name(n->in_pos, "nar_positions");
        ggml_set_input(n->in_pos);
        ggml_set_name(n->in_mask, "nar_mask");
        ggml_set_input(n->in_mask);

        n->input_buf = ggml_backend_alloc_ctx_tensors(n->input_ctx, n->backend);
        if (!n->input_buf) {
            fprintf(stderr, "[NAR] FATAL: failed to allocate input buffer\n");
            return false;
        }
    }

    // Latent projection, shared timestep embedding, frame embedding, the last
    // two broadcast over the variations
    struct ggml_tensor * hidden = nar_linear_bias(ctx, n->vae2llm_w, n->vae2llm_b, n->in_x);
    struct ggml_tensor * temb   = nar_linear_bias(ctx, n->time_w0, n->time_b0, n->in_time);
    temb                        = nar_linear_bias(ctx, n->time_w1, n->time_b1, ggml_silu(ctx, temb));
    ggml_set_name(temb, "temb_t");
    ggml_set_output(temb);
    hidden = ggml_add(ctx, hidden, temb);
    hidden = ggml_add(ctx, hidden, n->in_pos_emb);
    ggml_set_name(hidden, "hidden_after_input");
    ggml_set_output(hidden);

    const int probes[] = YUE2_NAR_PROBE_LAYERS;
    for (int l = 0; l < c.n_layers; l++) {
        Qwen3Layer *         ly   = &n->layers[l];
        struct ggml_tensor * norm = qwen3_rms_norm(ctx, hidden, ly->input_layernorm, c.rms_norm_eps);
        struct ggml_tensor * attn = nar_build_attn(ctx, c, ly, norm, n->in_pos, n->in_mask, kv->k[kv_set][l],
                                                   kv->v[kv_set][l], ar_len, N, M, n->use_flash_attn, n->clamp_fp16);
        if (l == 0) {
            ggml_set_name(attn, "layer0_sa_output");
            ggml_set_output(attn);
        }
        hidden = ggml_add(ctx, hidden, attn);
        if (n->clamp_fp16) {
            hidden = ggml_clamp(ctx, hidden, -65504.0f, 65504.0f);
        }
        norm   = qwen3_rms_norm(ctx, hidden, ly->post_attn_layernorm, c.rms_norm_eps);
        hidden = ggml_add(ctx, hidden, qwen3_build_mlp(ctx, ly, norm, N * M));
        if (n->clamp_fp16) {
            hidden = ggml_clamp(ctx, hidden, -65504.0f, 65504.0f);
        }
        for (int probe : probes) {
            if (l == probe) {
                char name[64];
                snprintf(name, sizeof(name), "hidden_after_layer%d", l);
                ggml_set_name(hidden, name);
                ggml_set_output(hidden);
            }
        }
    }

    hidden = qwen3_rms_norm(ctx, hidden, n->final_norm, c.rms_norm_eps);

    // Velocity head, then drop the LATENT_START and LATENT_END columns of
    // every variation
    struct ggml_tensor * pred = nar_linear_bias(ctx, n->llm2vae_w, n->llm2vae_b, hidden);
    n->out_v = ggml_cont(ctx, ggml_view_3d(ctx, pred, n->latent_dim, T_lat, M, pred->nb[1], pred->nb[2], pred->nb[1]));
    ggml_set_name(n->out_v, "nar_velocity");
    ggml_set_output(n->out_v);
    ggml_build_forward_expand(gf, n->out_v);

    n->graph     = gf;
    n->graph_T   = T_lat;
    n->graph_M   = M;
    n->graph_ar  = ar_len;
    n->graph_set = kv_set;

    if (new_shape) {
        n->scratch_pos_emb.resize((size_t) H * N);
        nar_pos_features(N, H, n->scratch_pos_emb.data());
        ggml_backend_tensor_set(n->in_pos_emb, n->scratch_pos_emb.data(), 0, n->scratch_pos_emb.size() * sizeof(float));

        n->scratch_pos.resize(N);
        for (int i = 0; i < N; i++) {
            n->scratch_pos[i] = ar_len + i;
        }
        ggml_backend_tensor_set(n->in_pos, n->scratch_pos.data(), 0, n->scratch_pos.size() * sizeof(int32_t));

        // Every NAR query sees every key, so the additive mask is uniformly zero
        std::vector<uint16_t> zeros((size_t) ggml_nelements(n->in_mask), 0);
        ggml_backend_tensor_set(n->in_mask, zeros.data(), 0, zeros.size() * sizeof(uint16_t));
    }
    if (new_key) {
        fprintf(stderr, "[NAR] Graph: %d nodes, T_lat=%d, variations=%d, prefix=%d, set=%d\n", ggml_graph_n_nodes(gf),
                T_lat, M, ar_len, kv_set);
    }
    return true;
}

// One velocity evaluation of M variations: x_t [M, T_lat, latent_dim] time
// major per variation, raw timestep shared. ar_len is the AR prefix length
// resident in set kv_set of the cache. Writes v in the layout of x_t.
static bool nar_velocity(Yue2NAR *            n,
                         const Qw3lmKvCache * kv,
                         const float *        x_t,
                         int                  T_lat,
                         int                  M,
                         int                  ar_len,
                         int                  kv_set,
                         float                raw_t,
                         float *              v_out) {
    if (!nar_build_graph(n, kv, T_lat, M, ar_len, kv_set)) {
        return false;
    }

    // Every evaluation allocates the graph before uploading and computing:
    // the topology is identical so the allocation is stable and the backend
    // graph cache stays hot.
    ggml_backend_sched_reset(n->sched);
    if (!ggml_backend_sched_alloc_graph(n->sched, n->graph)) {
        fprintf(stderr, "[NAR] FATAL: graph alloc failed for T_lat=%d\n", T_lat);
        return false;
    }

    // LATENT_START and LATENT_END are zero rows around every variation
    int    N     = T_lat + 2;
    size_t block = (size_t) n->latent_dim * T_lat;
    n->scratch_x.assign((size_t) n->latent_dim * N * M, 0.0f);
    for (int m = 0; m < M; m++) {
        memcpy(n->scratch_x.data() + (size_t) n->latent_dim * N * m + n->latent_dim, x_t + block * m,
               block * sizeof(float));
    }
    ggml_backend_tensor_set(n->in_x, n->scratch_x.data(), 0, n->scratch_x.size() * sizeof(float));

    float feats[YUE2_TIME_EMBED_DIM];
    nar_time_features(nar_shift_t(n, raw_t), feats);
    ggml_backend_tensor_set(n->in_time, feats, 0, sizeof(feats));

    ggml_backend_sched_graph_compute(n->sched, n->graph);
    ggml_backend_tensor_get(n->out_v, v_out, 0, block * M * sizeof(float));
    return true;
}

// Reads each named probe of the last computed graph and dumps its first
// variation time-major [N, ne0], the layout of the torch reference probes
static void nar_dump_named(const Yue2NAR * n, const DebugDumper * dbg) {
    const int                probes[] = YUE2_NAR_PROBE_LAYERS;
    const char *             fixed[]  = { "temb_t", "hidden_after_input", "layer0_sa_output" };
    std::vector<std::string> names(fixed, fixed + 3);
    for (int probe : probes) {
        names.push_back("hidden_after_layer" + std::to_string(probe));
    }
    for (const std::string & name : names) {
        struct ggml_tensor * t  = ggml_graph_get_tensor(n->graph, name.c_str());
        int64_t              n0 = t->ne[0];
        int64_t              n1 = t->ne[1];
        std::vector<float>   buf((size_t) n0 * n1);
        ggml_backend_tensor_get(t, buf.data(), 0, (size_t) n0 * n1 * sizeof(float));
        if (n1 <= 1) {
            debug_dump_1d(dbg, name.c_str(), buf.data(), (int) n0);
        } else {
            debug_dump_2d(dbg, name.c_str(), buf.data(), (int) n1, (int) n0);
        }
    }
}

// Midpoint flow matching solver, t walking from 1 down to 0.
// state [M, T_lat, latent_dim] holds the noise of every variation on entry
// and the latents on exit. The dumper, when enabled, records the first
// variation: the noise, the probes of the first evaluation, both velocities
// and the state of every step, and the latents.
static bool nar_solve(Yue2NAR *            n,
                      const Qw3lmKvCache * kv,
                      float *              state,
                      int                  T_lat,
                      int                  M,
                      int                  ar_len,
                      int                  kv_set,
                      int                  steps,
                      const DebugDumper *  dbg,
                      bool (*cancelled)(void *) = nullptr,
                      void * cancel_data        = nullptr) {
    size_t             count = (size_t) n->latent_dim * T_lat * M;
    std::vector<float> first(count), mid(count), second(count);
    float              dt = 1.0f / (float) steps;
    char               name[64];

    debug_dump_2d(dbg, "noise", state, T_lat, n->latent_dim);
    Timer solve_timer;
    for (int step = 0; step < steps; step++) {
        Timer step_timer;
        if (cancelled && cancelled(cancel_data)) {
            fprintf(stderr, "[NAR] Cancelled at step %d\n", step);
            return false;
        }
        float t = 1.0f - (float) step * dt;
        if (!nar_velocity(n, kv, state, T_lat, M, ar_len, kv_set, nar_logit_clamped(t), first.data())) {
            return false;
        }
        if (dbg->enabled && step == 0) {
            nar_dump_named(n, dbg);
        }
        for (size_t i = 0; i < count; i++) {
            mid[i] = state[i] - first[i] * (dt * 0.5f);
        }
        if (!nar_velocity(n, kv, mid.data(), T_lat, M, ar_len, kv_set, nar_logit_clamped(t - dt * 0.5f),
                          second.data())) {
            return false;
        }
        for (size_t i = 0; i < count; i++) {
            state[i] -= second[i] * dt;
        }
        snprintf(name, sizeof(name), "nar_step%d_first", step);
        debug_dump_2d(dbg, name, first.data(), T_lat, n->latent_dim);
        snprintf(name, sizeof(name), "nar_step%d_second", step);
        debug_dump_2d(dbg, name, second.data(), T_lat, n->latent_dim);
        snprintf(name, sizeof(name), "nar_step%d_xt", step);
        debug_dump_2d(dbg, name, state, T_lat, n->latent_dim);
        fprintf(stderr, "[NAR] Step %d/%d, %.0f ms\n", step + 1, steps, step_timer.ms());
    }
    debug_dump_2d(dbg, "nar_x0", state, T_lat, n->latent_dim);

    fprintf(stderr, "[NAR] Solved: T_lat=%d, %d variations, %d steps, %.0f ms (%.1f ms/step)\n", T_lat, M, steps,
            solve_timer.ms(), solve_timer.ms() / steps);
    return true;
}

static void nar_free(Yue2NAR * n) {
    if (n->arena.ctx) {
        ggml_backend_sched_reset(n->sched);
        graph_arena_free(&n->arena);
    }
    if (n->input_ctx) {
        ggml_backend_buffer_free(n->input_buf);
        ggml_free(n->input_ctx);
    }
    if (n->sched) {
        ggml_backend_sched_free(n->sched);
    }
    wctx_free(&n->wctx);
    backend_release(n->backend, n->cpu_backend);
    *n = {};
}
