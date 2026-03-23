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

    // libghostty-vt: headers and library from environment or default paths.
    // The build script (build/build.sh) sets GHOSTTY_INCLUDE_DIR and
    // GHOSTTY_LIB_DIR before invoking zig build.
    if (std.process.getEnvVarOwned(b.allocator, "GHOSTTY_INCLUDE_DIR")) |inc| {
        root_module.addIncludePath(.{ .cwd_relative = inc });
    } else |_| {
        // Fallback: ghostty source cloned by build script
        root_module.addIncludePath(.{ .cwd_relative = ".ghostty-src/include" });
    }

    if (std.process.getEnvVarOwned(b.allocator, "GHOSTTY_LIB_DIR")) |libdir| {
        root_module.addLibraryPath(.{ .cwd_relative = libdir });
    } else |_| {
        root_module.addLibraryPath(.{ .cwd_relative = ".ghostty-src/zig-out/lib" });
    }

    // Link against libghostty-vt
    root_module.linkSystemLibrary("ghostty-vt", .{});

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
