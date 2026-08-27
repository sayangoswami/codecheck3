#!/bin/bash
# Generate an NVIDIA CDI spec that podman < 5.0 (Ubuntu 24.04 ships podman
# 4.9.3) can actually load.
#
# nvidia-ctk >= ~1.17 emits `cdiVersion: 0.7.0` because it adds device-level
# `additionalGids` (for /dev/dri render-node access). podman 4.9's bundled
# CDI library only understands specs up to 0.6.0 and rejects the whole file
# ("the spec version must be at least v0.7.0" / "unresolvable CDI devices").
#
# For a compute-only workload (numba-cuda, CuPy) the /dev/dri GIDs are not
# needed — CUDA uses /dev/nvidia*. So: drop the `additionalGids` blocks and
# relabel the spec 0.6.0. Everything else (device nodes, driver-lib mounts,
# ldconfig hook) is already 0.6.0-compatible.
#
# Usage:
#   comrun-gpu/make-cdi-spec.sh | sudo tee /etc/cdi/nvidia.yaml > /dev/null
#   sudo rm -f /run/cdi/nvidia.yaml /var/run/cdi/nvidia.yaml
#   nvidia-ctk cdi list          # expect: Found N CDI devices, no warnings
#
# Re-run after every host driver upgrade (the mounts pin the driver version).

set -euo pipefail

nvidia-ctk cdi generate --format=yaml 2>/dev/null | awk '
  /^cdiVersion: 0\.7\.0$/ { print "cdiVersion: 0.6.0"; next }
  {
    if (skip) {
      match($0, /^ */); ind = RLENGTH
      if ($0 ~ /^[[:space:]]*$/ || ind > skipind) next
      skip = 0
    }
    if ($0 ~ /^[[:space:]]*additionalGids:[[:space:]]*$/) {
      match($0, /^ */); skipind = RLENGTH; skip = 1; next
    }
    print
  }
'
