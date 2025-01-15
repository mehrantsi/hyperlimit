#pragma once

#ifdef _WIN32
#include <intrin.h>
#include <immintrin.h>

#define __builtin_clzll __lzcnt64

inline void __builtin_prefetch(const void* addr, int rw = 0, int locality = 0) {
    _mm_prefetch((const char*)addr, _MM_HINT_T0);
}
#endif 