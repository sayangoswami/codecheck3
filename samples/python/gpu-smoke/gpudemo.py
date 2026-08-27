##CALL 8
##CALL 100
import numpy as np
import cupy as cp
from numba import cuda


@cuda.jit
def _double_kernel(x):
    i = cuda.grid(1)
    if i < x.size:
        x[i] = x[i] * 2


def sum_of_doubles(n) :
    ##HIDE
    a = np.arange(n, dtype=np.int64)
    d = cuda.to_device(a)
    threads = 32
    blocks = (n + threads - 1) // threads
    _double_kernel[blocks, threads](d)
    doubled = d.copy_to_host()
    return int(cp.asarray(doubled).sum())
    ##EDIT return ...
