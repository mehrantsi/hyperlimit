#include <napi.h>
#include "ratelimiter.hpp"

class HyperLimit : public Napi::ObjectWrap<HyperLimit> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "HyperLimit", {
            InstanceMethod("createLimiter", &HyperLimit::CreateLimiter),
            InstanceMethod("removeLimiter", &HyperLimit::RemoveLimiter),
            InstanceMethod("tryRequest", &HyperLimit::TryRequest),
            InstanceMethod("getTokens", &HyperLimit::GetTokens),
            InstanceMethod("getCurrentLimit", &HyperLimit::GetCurrentLimit),
            InstanceMethod("getRateLimitInfo", &HyperLimit::GetRateLimitInfo),
            InstanceMethod("addPenalty", &HyperLimit::AddPenalty),
            InstanceMethod("removePenalty", &HyperLimit::RemovePenalty),
            InstanceMethod("addToWhitelist", &HyperLimit::AddToWhitelist),
            InstanceMethod("addToBlacklist", &HyperLimit::AddToBlacklist),
            InstanceMethod("removeFromWhitelist", &HyperLimit::RemoveFromWhitelist),
            InstanceMethod("removeFromBlacklist", &HyperLimit::RemoveFromBlacklist),
            InstanceMethod("isWhitelisted", &HyperLimit::IsWhitelisted),
            InstanceMethod("isBlacklisted", &HyperLimit::IsBlacklisted),
            InstanceMethod("getStats", &HyperLimit::GetStats),
            InstanceMethod("resetStats", &HyperLimit::ResetStats),
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("HyperLimit", func);
        return exports;
    }

    HyperLimit(const Napi::CallbackInfo& info) : Napi::ObjectWrap<HyperLimit>(info) {
        Napi::Env env = info.Env();
        size_t bucketCount = 16384; // Default value

        if (info.Length() > 0 && info[0].IsObject()) {
            Napi::Object options = info[0].As<Napi::Object>();
            if (options.Has("bucketCount")) {
                Napi::Value val = options.Get("bucketCount");
                if (val.IsNumber()) {
                    bucketCount = val.As<Napi::Number>().Uint32Value();
                    if (bucketCount < 1024) {
                        Napi::Error::New(env, "bucketCount must be at least 1024")
                            .ThrowAsJavaScriptException();
                        return;
                    }
                }
            }
        }

        try {
            rateLimiter = std::make_unique<RateLimiter>(bucketCount);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        }
    }

private:
    std::unique_ptr<RateLimiter> rateLimiter;

    Napi::Value CreateLimiter(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 3) {
            Napi::TypeError::New(env, "Wrong number of arguments")
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        if (!info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();
        int64_t maxTokens = info[1].As<Napi::Number>().Int64Value();
        int64_t refillTimeMs = info[2].As<Napi::Number>().Int64Value();
        bool useSlidingWindow = info.Length() > 3 && info[3].IsBoolean() ? info[3].As<Napi::Boolean>().Value() : false;
        int64_t blockDurationMs = info.Length() > 4 && info[4].IsNumber() ? info[4].As<Napi::Number>().Int64Value() : 0;
        int64_t maxPenaltyPoints = info.Length() > 5 && info[5].IsNumber() ? info[5].As<Napi::Number>().Int64Value() : 0;
        std::string distributedKey = info.Length() > 6 && info[6].IsString() ? info[6].As<Napi::String>().Utf8Value() : "";

        try {
            rateLimiter->createLimiter(key, maxTokens, refillTimeMs, useSlidingWindow, blockDurationMs, maxPenaltyPoints, distributedKey);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value RemoveLimiter(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();

        try {
            rateLimiter->removeLimiter(key);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value TryRequest(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();
        std::string ip = info.Length() > 1 && info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : "";

        try {
            bool allowed = rateLimiter->tryRequest(key, ip);
            return Napi::Boolean::New(env, allowed);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value GetTokens(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();

        try {
            int64_t tokens = rateLimiter->getTokens(key);
            return Napi::Number::New(env, tokens);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value GetCurrentLimit(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();

        try {
            int64_t limit = rateLimiter->getCurrentLimit(key);
            return Napi::Number::New(env, limit);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value GetRateLimitInfo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();

        try {
            auto limitInfo = rateLimiter->getRateLimitInfo(key);
            auto result = Napi::Object::New(env);
            result.Set("limit", limitInfo.limit);
            result.Set("remaining", limitInfo.remaining);
            result.Set("reset", limitInfo.reset);
            result.Set("blocked", limitInfo.blocked);
            if (!limitInfo.retryAfter.empty()) {
                result.Set("retryAfter", limitInfo.retryAfter);
            }
            return result;
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value AddPenalty(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();
        int64_t points = info[1].As<Napi::Number>().Int64Value();

        try {
            rateLimiter->addPenalty(key, points);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value RemovePenalty(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string key = info[0].As<Napi::String>().Utf8Value();
        int64_t points = info[1].As<Napi::Number>().Int64Value();

        try {
            rateLimiter->removePenalty(key, points);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value AddToWhitelist(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string ip = info[0].As<Napi::String>().Utf8Value();

        try {
            rateLimiter->addToWhitelist(ip);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value AddToBlacklist(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string ip = info[0].As<Napi::String>().Utf8Value();

        try {
            rateLimiter->addToBlacklist(ip);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value RemoveFromWhitelist(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string ip = info[0].As<Napi::String>().Utf8Value();

        try {
            rateLimiter->removeFromWhitelist(ip);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value RemoveFromBlacklist(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string ip = info[0].As<Napi::String>().Utf8Value();

        try {
            rateLimiter->removeFromBlacklist(ip);
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value IsWhitelisted(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string ip = info[0].As<Napi::String>().Utf8Value();

        try {
            bool whitelisted = rateLimiter->isWhitelisted(ip);
            return Napi::Boolean::New(env, whitelisted);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value IsBlacklisted(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Wrong arguments").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string ip = info[0].As<Napi::String>().Utf8Value();

        try {
            bool blacklisted = rateLimiter->isBlacklisted(ip);
            return Napi::Boolean::New(env, blacklisted);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value GetStats(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        try {
            auto stats = rateLimiter->getStats();
            auto result = Napi::Object::New(env);
            result.Set("totalRequests", stats.totalRequests);
            result.Set("allowedRequests", stats.allowedRequests);
            result.Set("blockedRequests", stats.blockedRequests);
            result.Set("penalizedRequests", stats.penalizedRequests);
            result.Set("allowRate", stats.allowRate);
            result.Set("blockRate", stats.blockRate);
            result.Set("penaltyRate", stats.penaltyRate);
            return result;
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value ResetStats(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        try {
            rateLimiter->resetStats();
            return Napi::Boolean::New(env, true);
        } catch (const std::exception& e) {
            Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return HyperLimit::Init(env, exports);
}

NODE_API_MODULE(hyperlimit, Init) 