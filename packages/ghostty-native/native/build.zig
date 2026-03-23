const std = @import("std");

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Create the root module for our N-API library
    const root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    // napigen dependency — provides N-API bindings for Zig
    const napigen_dep = b.dependency("napigen", .{});
    root_module.addImport("napigen", napigen_dep.module("napigen"));

    // ghostty dependency — provides the terminal emulation core as a Zig module.
    // This compiles ghostty's terminal code directly into our library (no separate
    // libghostty-vt shared library needed). Uses ghostty's own build system which
    // handles all dependencies (unicode tables, SIMD, etc.).
    if (b.lazyDependency("ghostty", .{})) |ghostty_dep| {
        root_module.addImport("ghostty", ghostty_dep.module("ghostty-vt"));
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
