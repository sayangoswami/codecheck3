# GPU-enabled comrun for a numba-cuda / CuPy CodeCheck instance.
#
# Build context is the REPOSITORY ROOT (it needs comrun/bin/*), e.g.
#   podman build -f comrun-gpu/Dockerfile -t comrun-gpu .
# docker-compose.gpu.yml already sets the context correctly.
#
# The CUDA version below must be <= the HOST driver's max (the driver is
# injected at run time by the NVIDIA container toolkit; the CUDA
# userspace/toolkit lives in this image). Check `nvidia-smi` on the host —
# its "CUDA Version" is the newest toolkit that driver supports (here: 13.2,
# driver 595.84). Keep the cupy wheel (cupy-cuda13x) on the same major as
# this tag.
FROM nvidia/cuda:13.0.1-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install --no-install-recommends -y \
      ca-certificates \
      wget \
      grep \
      zip \
      unzip \
      sudo \
      python3 \
      python3-pip \
      python3-tk \
      nodejs \
      npm \
      locales \
 && rm -rf /var/lib/apt/lists/*

RUN locale-gen --no-purge en_US.UTF-8
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8

# GPU Python stack. numba-cuda uses the NVIDIA cuda-python bindings (default
# on CUDA 13) and picks up NVVM from the -devel image via CUDA_HOME.
ENV CUDA_HOME=/usr/local/cuda
ENV NUMBA_CUDA_USE_NVIDIA_BINDING=1
RUN pip install --no-cache-dir --break-system-packages \
      numpy \
      numba \
      numba-cuda \
      cuda-python \
      "cupy-cuda13x"

# Restricted OS user that submitted code actually runs as (same scheme as
# comrun/Dockerfile). sudo needs SETUID/SETGID, so this image does NOT drop
# caps or set no-new-privileges the way comrun-java's compose entry does.
RUN useradd -u 1012 -ms /bin/bash comrunner \
 && usermod -aG video comrunner
RUN echo "Defaults:root !syslog, !pam_session"      >> /etc/sudoers \
 && echo "Defaults:comrunner !syslog, !pam_session" >> /etc/sudoers

ENV COMRUN_USER=comrunner
ENV NUMBA_CACHE_DIR=/tmp/numba-cache
RUN mkdir -p /tmp/codecheck /tmp/numba-cache && chmod 733 /tmp/codecheck && chmod 777 /tmp/numba-cache

# Stock comrun engine (comrun + preload.sh + interleaveio.py already handle Python).
COPY comrun/bin /opt/codecheck

# preload.sh caps Python at `ulimit -v 100000` (~100 MB of virtual address
# space) and `-n 100` (open files). CUDA/CuPy/numba reserve tens of GB of
# *virtual* memory on context creation and dlopen/mmap many libraries, so
# those caps make every GPU program fail instantly. Keep only the file-size
# cap (-f, anti-fill-disk); real memory is bounded by the container's
# mem_limit instead (see docker-compose.gpu.yml).
RUN sed -i -E 's/ulimit -d [0-9]+ -f ([0-9]+) -n [0-9]+ -v [0-9]+/ulimit -f \1/g' /opt/codecheck/preload.sh \
 && ! grep -qE 'ulimit .*-v [0-9]' /opt/codecheck/preload.sh   # fail the build if any -v cap survived

# Concurrency-gated gateway (replaces the stock comrun/bin/server.js).
COPY comrun-gpu/server.js /opt/codecheck/server.js
COPY comrun-gpu/package.json /opt/codecheck/package.json
RUN cd /opt/codecheck && npm install --omit=dev --no-audit --no-fund

RUN chmod -R 755 /opt/codecheck

EXPOSE 8080
CMD [ "node", "/opt/codecheck/server.js" ]
