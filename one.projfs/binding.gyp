{
  "targets": [
    {
      "target_name": "ifsprojfs",
      "sources": [
        "src/native_provider.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "libraries": [
        "ProjectedFSLib.lib", "Shell32.lib", "Ole32.lib"
      ],
      "defines": [
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17"]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "defines": ["_WIN32_WINNT=0x0A00"]
        }]
      ]
    }
  ]
}
