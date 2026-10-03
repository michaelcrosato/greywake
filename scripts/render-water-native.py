"""Draw exported Greywake shaders and geometry through surfaceless GLES.

This is a material/geometry preview. It does not emulate the browser compositor,
planar reflection/refraction passes, WebGPU, DOM, or input controls.
"""

import ctypes as C
import importlib.util
import json
import struct
import sys
import zlib
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "water_glsl", Path(__file__).with_name("verify-water-glsl.py")
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
bind = helper.bind


def png(path, width, height, pixels):
    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    rows = b"".join(
        b"\0" + pixels[row * width * 4 : (row + 1) * width * 4]
        for row in range(height - 1, -1, -1)
    )
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def main():
    egl, gl, display = helper.create_context(960, 600)
    ui, integer, pointer = C.c_uint, C.c_int, C.c_void_p
    fn = {
        "glCreateShader": (ui, [ui]),
        "glShaderSource": (
            None,
            [ui, integer, C.POINTER(C.c_char_p), C.POINTER(integer)],
        ),
        "glCompileShader": (None, [ui]),
        "glGetShaderiv": (None, [ui, ui, C.POINTER(integer)]),
        "glGetShaderInfoLog": (None, [ui, integer, C.POINTER(integer), C.c_char_p]),
        "glCreateProgram": (ui, []),
        "glAttachShader": (None, [ui, ui]),
        "glLinkProgram": (None, [ui]),
        "glGetProgramiv": (None, [ui, ui, C.POINTER(integer)]),
        "glGetProgramInfoLog": (None, [ui, integer, C.POINTER(integer), C.c_char_p]),
        "glDeleteShader": (None, [ui]),
        "glDeleteProgram": (None, [ui]),
        "glUseProgram": (None, [ui]),
        "glGenBuffers": (None, [integer, C.POINTER(ui)]),
        "glBindBuffer": (None, [ui, ui]),
        "glBufferData": (None, [ui, C.c_ssize_t, pointer, ui]),
        "glDeleteBuffers": (None, [integer, C.POINTER(ui)]),
        "glGenTextures": (None, [integer, C.POINTER(ui)]),
        "glBindTexture": (None, [ui, ui]),
        "glActiveTexture": (None, [ui]),
        "glTexParameteri": (None, [ui, ui, integer]),
        "glTexImage2D": (
            None,
            [ui, integer, integer, integer, integer, integer, ui, ui, pointer],
        ),
        "glGenerateMipmap": (None, [ui]),
        "glDeleteTextures": (None, [integer, C.POINTER(ui)]),
        "glGetUniformLocation": (integer, [ui, C.c_char_p]),
        "glUniform1i": (None, [integer, integer]),
        "glGetUniformBlockIndex": (ui, [ui, C.c_char_p]),
        "glUniformBlockBinding": (None, [ui, ui, ui]),
        "glBindBufferBase": (None, [ui, ui, ui]),
        "glGetAttribLocation": (integer, [ui, C.c_char_p]),
        "glVertexAttribPointer": (None, [ui, integer, ui, C.c_ubyte, integer, pointer]),
        "glVertexAttribDivisor": (None, [ui, ui]),
        "glEnableVertexAttribArray": (None, [ui]),
        "glGenVertexArrays": (None, [integer, C.POINTER(ui)]),
        "glBindVertexArray": (None, [ui]),
        "glDeleteVertexArrays": (None, [integer, C.POINTER(ui)]),
        "glDrawElements": (None, [ui, integer, ui, pointer]),
        "glDrawElementsInstanced": (None, [ui, integer, ui, pointer, integer]),
        "glDrawArrays": (None, [ui, integer, integer]),
        "glEnable": (None, [ui]),
        "glDisable": (None, [ui]),
        "glDepthMask": (None, [C.c_ubyte]),
        "glDepthFunc": (None, [ui]),
        "glBlendFunc": (None, [ui, ui]),
        "glClearColor": (None, [C.c_float, C.c_float, C.c_float, C.c_float]),
        "glClear": (None, [ui]),
        "glViewport": (None, [integer, integer, integer, integer]),
        "glPixelStorei": (None, [ui, integer]),
        "glReadPixels": (None, [integer, integer, integer, integer, ui, ui, pointer]),
        "glFinish": (None, []),
        "glGetError": (ui, []),
    }
    functions = {
        name: bind(gl, name, result, *args) for name, (result, args) in fn.items()
    }

    def call(name, *args):
        return functions["gl" + name](*args)

    def buffer(target, data):
        handle = ui()
        call("GenBuffers", 1, C.byref(handle))
        call("BindBuffer", target, handle.value)
        array = C.create_string_buffer(data)
        call("BufferData", target, len(data), array, 0x88E4)
        return handle

    def program(vertex, fragment):
        handle = call("CreateProgram")
        for source, kind in [(vertex, 0x8B31), (fragment, 0x8B30)]:
            shader = call("CreateShader", kind)
            string = C.c_char_p(source.encode())
            call("ShaderSource", shader, 1, C.byref(string), None)
            call("CompileShader", shader)
            status = integer()
            call("GetShaderiv", shader, 0x8B81, C.byref(status))
            if not status.value:
                log = C.create_string_buffer(32768)
                call("GetShaderInfoLog", shader, len(log), None, log)
                raise RuntimeError(log.value.decode())
            call("AttachShader", handle, shader)
            call("DeleteShader", shader)
        call("LinkProgram", handle)
        status = integer()
        call("GetProgramiv", handle, 0x8B82, C.byref(status))
        if not status.value:
            log = C.create_string_buffer(32768)
            call("GetProgramInfoLog", handle, len(log), None, log)
            raise RuntimeError(log.value.decode())
        return handle

    reports = []
    for folder in sorted(Path("artifacts/water-upgrade/native").iterdir()):
        if len(sys.argv) > 1 and folder.name != sys.argv[1]:
            continue
        if not folder.is_dir() or not (folder / "scene.json").exists():
            continue
        scene = json.loads((folder / "scene.json").read_text())
        width, height = scene["width"], scene["height"]
        call("Viewport", 0, 0, width, height)
        call("ClearColor", *scene["clear"])
        call("DepthMask", 1)
        call("Clear", 0x4000 | 0x0100)
        call("Disable", 0x0B44)
        call("Disable", 0x0BE2)
        call("DepthFunc", 0x0203)
        call("PixelStorei", 0x0CF5, 1)
        textures = []
        for record in scene["textures"]:
            texture = ui()
            call("GenTextures", 1, C.byref(texture))
            call("BindTexture", 0x0DE1, texture.value)
            datatype = {1009: 0x1401, 1016: 0x140B, 1015: 0x1406}[record["type"]]
            internal = (
                0x881A
                if datatype == 0x140B
                else 0x8814
                if datatype == 0x1406
                else 0x8C43
                if record["srgb"]
                else 0x8058
            )
            pixels = C.create_string_buffer((folder / record["file"]).read_bytes())
            call(
                "TexImage2D",
                0x0DE1,
                0,
                internal,
                record["width"],
                record["height"],
                0,
                0x1908,
                datatype,
                pixels,
            )
            call(
                "TexParameteri", 0x0DE1, 0x2801, 0x2703 if record["mipmaps"] else 0x2601
            )
            call("TexParameteri", 0x0DE1, 0x2800, 0x2601)
            for axis in [0x2802, 0x2803]:
                call(
                    "TexParameteri",
                    0x0DE1,
                    axis,
                    0x2901 if record["repeat"] else 0x812F,
                )
            if record["mipmaps"]:
                call("GenerateMipmap", 0x0DE1)
            textures.append(texture)
        for mesh in scene["meshes"]:
            p = program(
                (folder / f"mesh-{mesh['id']}.vert.glsl").read_text(),
                (folder / f"mesh-{mesh['id']}.frag.glsl").read_text(),
            )
            call("UseProgram", p)
            vao = ui()
            call("GenVertexArrays", 1, C.byref(vao))
            call("BindVertexArray", vao.value)
            buffers = []
            for slot, uniform in enumerate(mesh["uniforms"]):
                index = call("GetUniformBlockIndex", p, uniform["name"].encode())
                if index == 0xFFFFFFFF:
                    continue
                handle = buffer(0x8A11, (folder / uniform["file"]).read_bytes())
                buffers.append(handle)
                call("UniformBlockBinding", p, index, slot)
                call("BindBufferBase", 0x8A11, slot, handle.value)
            for unit, sampler in enumerate(mesh["samplers"]):
                location = call("GetUniformLocation", p, sampler["name"].encode())
                if location < 0:
                    continue
                call("ActiveTexture", 0x84C0 + unit)
                call("BindTexture", 0x0DE1, textures[sampler["texture"]].value)
                call("Uniform1i", location, unit)
            for attribute in mesh["attributes"]:
                location = call("GetAttribLocation", p, attribute["name"].encode())
                if location < 0:
                    continue
                buffers.append(
                    buffer(0x8892, (folder / attribute["file"]).read_bytes())
                )
                call("EnableVertexAttribArray", location)
                call(
                    "VertexAttribPointer",
                    location,
                    attribute["size"],
                    0x1406,
                    0,
                    attribute.get("stride", 0),
                    pointer(attribute.get("offset", 0)),
                )
                call(
                    "VertexAttribDivisor",
                    location,
                    int(attribute.get("instanced", False)),
                )
            call("Enable" if mesh["depthTest"] else "Disable", 0x0B71)
            call("DepthMask", int(mesh["depthWrite"]))
            call("Enable" if mesh.get("transparent") else "Disable", 0x0BE2)
            call("BlendFunc", 0x0302, 0x0303)
            if mesh["index"]:
                buffers.append(buffer(0x8893, (folder / mesh["index"]).read_bytes()))
                if mesh.get("instances"):
                    call(
                        "DrawElementsInstanced",
                        4,
                        mesh["count"],
                        mesh["indexType"],
                        None,
                        mesh["instances"],
                    )
                else:
                    call("DrawElements", 4, mesh["count"], mesh["indexType"], None)
            else:
                call("DrawArrays", 4, 0, mesh["count"])
            error = call("GetError")
            if error:
                raise RuntimeError(
                    f"{folder.name} mesh {mesh['id']}: GL error {hex(error)}"
                )
            for handle in buffers:
                call("DeleteBuffers", 1, C.byref(handle))
            call("DeleteVertexArrays", 1, C.byref(vao))
            call("DeleteProgram", p)
        call("Finish")
        pixels = C.create_string_buffer(width * height * 4)
        call("ReadPixels", 0, 0, width, height, 0x1908, 0x1401, pixels)
        png(folder.with_suffix(".png"), width, height, pixels.raw)
        for handle in textures:
            call("DeleteTextures", 1, C.byref(handle))
        reports.append(
            {
                "scene": folder.name,
                "image": str(folder.with_suffix(".png")),
                "scope": scene["scope"],
            }
        )
        print(f"RENDERED {folder.name}", flush=True)
    (Path("artifacts/water-upgrade/native") / "report.json").write_text(
        json.dumps(reports, indent=2)
    )
    bind(egl, "eglTerminate", C.c_uint, pointer)(display)


if __name__ == "__main__":
    main()
