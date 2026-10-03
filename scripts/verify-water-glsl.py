"""Compile and link the generated ocean shaders with a real surfaceless GLES driver."""

import ctypes as C
import json
from pathlib import Path


def bind(lib, name, result, *arguments):
    function = getattr(lib, name)
    function.restype = result
    function.argtypes = list(arguments)
    return function


def create_context(width=16, height=16):
    egl = C.CDLL("libEGL.so.1")
    gl = C.CDLL("libGLESv2.so.2")
    integer, pointer = C.c_int, C.c_void_p
    display = bind(egl, "eglGetPlatformDisplay", pointer, C.c_uint, pointer, pointer)(
        0x31DD, None, None
    )
    major, minor = integer(), integer()
    assert bind(
        egl, "eglInitialize", C.c_uint, pointer, C.POINTER(integer), C.POINTER(integer)
    )(display, C.byref(major), C.byref(minor))
    bind(egl, "eglBindAPI", C.c_uint, C.c_uint)(0x30A0)
    attributes = (integer * 15)(
        0x3024,
        8,
        0x3023,
        8,
        0x3022,
        8,
        0x3021,
        8,
        0x3033,
        1,
        0x3040,
        0x40,
        0x3025,
        24,
        0x3038,
    )
    config, count = pointer(), integer()
    assert (
        bind(
            egl,
            "eglChooseConfig",
            C.c_uint,
            pointer,
            C.POINTER(integer),
            C.POINTER(pointer),
            integer,
            C.POINTER(integer),
        )(display, attributes, C.byref(config), 1, C.byref(count))
        and count.value
    )
    surface_attributes = (integer * 5)(0x3057, width, 0x3056, height, 0x3038)
    surface = bind(
        egl, "eglCreatePbufferSurface", pointer, pointer, pointer, C.POINTER(integer)
    )(display, config, surface_attributes)
    context_attributes = (integer * 3)(0x3098, 3, 0x3038)
    context = bind(
        egl, "eglCreateContext", pointer, pointer, pointer, pointer, C.POINTER(integer)
    )(display, config, None, context_attributes)
    assert bind(egl, "eglMakeCurrent", C.c_uint, pointer, pointer, pointer, pointer)(
        display, surface, surface, context
    )
    return egl, gl, display


def main():
    egl, gl, display = create_context()
    integer = C.c_int
    pointer = C.c_void_p
    create_shader = bind(gl, "glCreateShader", C.c_uint, C.c_uint)
    source_shader = bind(
        gl,
        "glShaderSource",
        None,
        C.c_uint,
        integer,
        C.POINTER(C.c_char_p),
        C.POINTER(integer),
    )
    compile_shader = bind(gl, "glCompileShader", None, C.c_uint)
    shader_status = bind(
        gl, "glGetShaderiv", None, C.c_uint, C.c_uint, C.POINTER(integer)
    )
    shader_log = bind(
        gl,
        "glGetShaderInfoLog",
        None,
        C.c_uint,
        integer,
        C.POINTER(integer),
        C.c_char_p,
    )
    create_program = bind(gl, "glCreateProgram", C.c_uint)
    attach = bind(gl, "glAttachShader", None, C.c_uint, C.c_uint)
    link = bind(gl, "glLinkProgram", None, C.c_uint)
    program_status = bind(
        gl, "glGetProgramiv", None, C.c_uint, C.c_uint, C.POINTER(integer)
    )
    program_log = bind(
        gl,
        "glGetProgramInfoLog",
        None,
        C.c_uint,
        integer,
        C.POINTER(integer),
        C.c_char_p,
    )
    delete_shader = bind(gl, "glDeleteShader", None, C.c_uint)
    delete_program = bind(gl, "glDeleteProgram", None, C.c_uint)
    renderer = bind(gl, "glGetString", C.c_char_p, C.c_uint)(0x1F01).decode()
    folder = Path("artifacts/water-upgrade/shaders")
    results = []
    for vertex in sorted(folder.glob("webgl-*.vert.glsl")):
        program = create_program()
        for path, kind in [
            (vertex, 0x8B31),
            (Path(str(vertex).replace(".vert.", ".frag.")), 0x8B30),
        ]:
            shader = create_shader(kind)
            source = path.read_bytes()
            source_pointer = C.c_char_p(source)
            source_shader(shader, 1, C.byref(source_pointer), None)
            compile_shader(shader)
            status = integer()
            shader_status(shader, 0x8B81, C.byref(status))
            if not status.value:
                log = C.create_string_buffer(32768)
                shader_log(shader, len(log), None, log)
                raise RuntimeError(f"{path}: {log.value.decode()}")
            attach(program, shader)
            delete_shader(shader)
        link(program)
        status = integer()
        program_status(program, 0x8B82, C.byref(status))
        if not status.value:
            log = C.create_string_buffer(32768)
            program_log(program, len(log), None, log)
            raise RuntimeError(f"{vertex}: {log.value.decode()}")
        results.append(vertex.stem)
        print(f"PASS driver compile/link {vertex.stem}")
        delete_program(program)
    (folder / "driver-report.json").write_text(
        json.dumps(
            {
                "driver": renderer,
                "checks": results,
                "scope": "Real GLES compile/link; no browser or screenshot",
            },
            indent=2,
        )
    )
    bind(egl, "eglTerminate", C.c_uint, pointer)(display)


if __name__ == "__main__":
    main()
