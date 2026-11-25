const std = @import("std");
const translate_c = @import("translate_c");

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Create the root module for our N-API library
    const root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .strip = optimize != .debug,
        .link_libc = true,
    });

    // Local napigen module backed by translate_c over node_api.h (Zig 0.17 removed @cImport)
    const node_api_dep = b.dependency("node_api", .{});
    const napigen_module = b.createModule(.{
        .root_source_file = b.path("src/napigen.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    try translate_c.addImportToModule(b, "napi_c", napigen_module, .{
        .source = .{ .includes = .{
            .generated_name = "napi_c.h",
            .files = &.{.{ .path = "node_api.h", .type = .user }},
        } },
        .target = target,
        .optimize = optimize,
        .include_paths = &.{node_api_dep.path("include")},
    });
    root_module.addImport("napigen", napigen_module);

    // ghostty dependency — provides the terminal emulation core as a Zig module.
    // This compiles ghostty's terminal code directly into our library (no separate
    // libghostty-vt shared library needed). Uses ghostty's own build system which
    // handles all dependencies (unicode tables, SIMD, etc.).
    if (b.lazyDependency("ghostty", .{})) |ghostty_dep| {
        const ghostty_module = ghostty_dep.module("ghostty-vt");
        root_module.addImport("ghostty", ghostty_module);
        // Read the very same generated options module as the library, without selecting or overriding its flags.
        root_module.addImport("ghostty_terminal_options", ghostty_module.import_table.get("terminal_options").?);
    }

    // Build as a shared library (.dylib/.so)
    const lib = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "termless_ghostty_native",
        .root_module = root_module,
    });

    // Allow weak linkage for N-API symbols — they're resolved at load time
    // by Node.js/Bun (same as what napigen's setup() does on non-Windows)
    lib.linker_allow_shlib_undefined = true;

    // Install the shared library
    b.installArtifact(lib);

    // Also copy as .node for N-API loading
    const copy_node = b.addInstallLibFile(
        lib.getEmittedBin(),
        "termless-ghostty-native.node",
    );
    b.getInstallStep().dependOn(&copy_node.step);
}
