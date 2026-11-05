/* Build-time metadata only: no Screen instance or target memory is read. */
#include "screen.h"
#include <stddef.h>
#include <stdio.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "This pinned Kitty layout is supported only on Linux x86_64"
#endif

#ifndef Py_DEBUG
#define Py_DEBUG 0
#endif
#ifndef Py_TRACE_REFS
#define Py_TRACE_REFS 0
#endif
#ifndef Py_GIL_DISABLED
#define Py_GIL_DISABLED 0
#endif

_Static_assert(_Generic(((Screen *)0)->modes.mDECSCNM, bool: 1, default: 0), "mDECSCNM must be bool");
_Static_assert(_Generic(((Screen *)0)->paused_rendering.expires_at, int64_t: 1, default: 0), "expires_at must be int64_t");
_Static_assert(_Generic(((Screen *)0)->modes.mouse_tracking_mode, unsigned int: 1, default: 0), "mouse_tracking_mode must be unsigned int");

int main(void) {
    const unsigned int endian = 1;
    printf("{\n"
           "  \"platform\": {\"system\": \"Linux\", \"machine\": \"x86_64\", \"byteOrder\": \"%s\", \"pointerSize\": %zu},\n"
           "  \"python\": {\"implementation\": \"CPython\", \"major\": %d, \"minor\": %d, \"pyDebug\": %d, \"pyTraceRefs\": %d, \"pyGilDisabled\": %d},\n"
           "  \"screen\": {\"size\": %zu, \"reverseVideo\": {\"offset\": %zu, \"width\": %zu, \"cType\": \"bool\"}, "
           "\"syncOutput\": {\"offset\": %zu, \"width\": %zu, \"cType\": \"int64_t\"}, "
           "\"mouseTracking\": {\"offset\": %zu, \"width\": %zu, \"cType\": \"unsigned int\"}}\n"
           "}\n",
           *(const unsigned char *)&endian == 1 ? "little" : "big", sizeof(void *),
           PY_MAJOR_VERSION, PY_MINOR_VERSION, Py_DEBUG, Py_TRACE_REFS, Py_GIL_DISABLED,
           sizeof(Screen), offsetof(Screen, modes) + offsetof(ScreenModes, mDECSCNM),
           sizeof(((Screen *)0)->modes.mDECSCNM), offsetof(Screen, paused_rendering.expires_at),
           sizeof(((Screen *)0)->paused_rendering.expires_at),
           offsetof(Screen, modes) + offsetof(ScreenModes, mouse_tracking_mode),
           sizeof(((Screen *)0)->modes.mouse_tracking_mode));
    return 0;
}
