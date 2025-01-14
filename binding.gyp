{
  "targets": [{
    "target_name": "hyperlimit",
    "cflags!": [ "-fno-exceptions" ],
    "cflags_cc!": [ "-fno-exceptions" ],
    "cflags": [ "-O3" ],
    "cflags_cc": [ "-O3" ],
    "xcode_settings": {
      "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
      "CLANG_CXX_LIBRARY": "libc++",
      "MACOSX_DEPLOYMENT_TARGET": "10.15",
      "OTHER_CFLAGS": [ "-O3" ]
    },
    "msvs_settings": {
      "VCCLCompilerTool": { 
        "ExceptionHandling": 1,
        "Optimization": 3
      }
    },
    "sources": [
      "src/native/hyperlimit.cpp"
    ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "src/native"
    ],
    'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ]
  }]
} 