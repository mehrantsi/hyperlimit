{
  "targets": [{
    "target_name": "hyperlimit",
    "sources": [
      "src/native/hyperlimit.cpp"
    ],
    "cflags!": [ "-fno-exceptions" ],
    "cflags_cc!": [ "-fno-exceptions" ],
    "cflags": [ "-O3" ],
    "cflags_cc": [ "-O3", "-std=c++17", "-faligned-new" ],
    "xcode_settings": {
      "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
      "CLANG_CXX_LIBRARY": "libc++",
      "MACOSX_DEPLOYMENT_TARGET": "10.15",
      "OTHER_CFLAGS": [ "-O3" ],
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "OTHER_CPLUSPLUSFLAGS": [ "-faligned-new" ]
    },
    "msvs_settings": {
      "VCCLCompilerTool": { 
        "ExceptionHandling": 1,
        "Optimization": 3,
        "AdditionalOptions": [
          "/std:c++17",
          "/Zc:alignedNew",
          "/DWIN32",
          "/D_WINDOWS",
          "/EHsc",
          "/FI\"src/native/win_compat.h\""
        ]
      }
    },
    "conditions": [
      ['OS=="win"', {
        "include_dirs": [
          "<!@(node -p \"require('node-addon-api').include\")",
          "<!@(echo %VCPKG_ROOT%)/installed/x64-windows/include"
        ],
        "libraries": [
          "<!@(echo %VCPKG_ROOT%)/installed/x64-windows/lib/hiredis.lib"
        ],
        "defines": [
          "NAPI_DISABLE_CPP_EXCEPTIONS",
          "NOMINMAX",
          "WIN32_LEAN_AND_MEAN"
        ]
      }, {
        "include_dirs": [
          "<!@(node -p \"require('node-addon-api').include\")",
          "/usr/include",
          "/usr/local/include",
          "/opt/homebrew/include"
        ],
        "libraries": [
          "-L/usr/lib",
          "-L/usr/lib64",
          "-L/usr/local/lib",
          "-L/usr/local/lib64",
          "-L/opt/homebrew/lib",
          "-lhiredis"
        ],
        "defines": [
          "NAPI_DISABLE_CPP_EXCEPTIONS"
        ]
      }]
    ]
  }]
} 