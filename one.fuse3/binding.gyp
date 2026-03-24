{
  "targets": [
    {
      "target_name": "fuse3_napi",
      "sources": [ 
        "fuse3_napi.cc",
        "fuse3_operations.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ 
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "FUSE_USE_VERSION=31",
        "_FILE_OFFSET_BITS=64"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "cflags": [
        "-Wall",
        "-Wextra",
        "-O3"
      ],
      "conditions": [
        ["OS=='linux'", {
          "libraries": [
            "-lfuse3"
          ],
          "include_dirs": [
            "/usr/include/fuse3"
          ]
        }],
        ["OS!='linux'", {
          "type": "none"
        }]
      ]
    }
  ]
}