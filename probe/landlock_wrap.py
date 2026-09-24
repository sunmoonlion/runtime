"""Outer ceiling for exec-server on Linux via Landlock (no namespaces, so Codex's own bwrap sandbox still works inside).
Everything readable + executable; writes allowed only under --rw paths; --no-net denies TCP bind/connect (ABI>=4).
Usage: python3 landlock_wrap.py --rw DIR [--rw DIR ...] [--no-net] -- cmd args...
"""
import ctypes, ctypes.util, os, sys
libc=ctypes.CDLL(ctypes.util.find_library("c"),use_errno=True)
SYS_create,SYS_add,SYS_restrict=444,445,446
FS_EXECUTE,FS_WRITE_FILE,FS_READ_FILE,FS_READ_DIR=1<<0,1<<1,1<<2,1<<3
FS_REMOVE_DIR,FS_REMOVE_FILE,FS_MAKE_CHAR,FS_MAKE_DIR,FS_MAKE_REG,FS_MAKE_SOCK,FS_MAKE_FIFO,FS_MAKE_BLOCK,FS_MAKE_SYM=1<<4,1<<5,1<<6,1<<7,1<<8,1<<9,1<<10,1<<11,1<<12
FS_REFER,FS_TRUNCATE,FS_IOCTL_DEV=1<<13,1<<14,1<<15
NET_BIND_TCP,NET_CONNECT_TCP=1<<0,1<<1
class RulesetAttr(ctypes.Structure): _fields_=[("handled_access_fs",ctypes.c_uint64),("handled_access_net",ctypes.c_uint64)]
class PathBeneath(ctypes.Structure): _pack_=1; _fields_=[("allowed_access",ctypes.c_uint64),("parent_fd",ctypes.c_int32)]
class NetPort(ctypes.Structure): _pack_=1; _fields_=[("allowed_access",ctypes.c_uint64),("port",ctypes.c_uint64)]
def sc(n,*a):
    r=libc.syscall(n,*a)
    if r<0: e=ctypes.get_errno(); raise OSError(e,f"landlock syscall {n}: {os.strerror(e)}")
    return r
def main():
    rw=[]; no_net=False; i=1
    while i<len(sys.argv) and sys.argv[i]!="--":
        if sys.argv[i]=="--rw": rw.append(os.path.abspath(sys.argv[i+1])); i+=2
        elif sys.argv[i]=="--no-net": no_net=True; i+=1
        else: sys.exit(f"bad arg {sys.argv[i]}")
    cmd=sys.argv[i+1:]
    abi=sc(SYS_create,None,0,1)  # LANDLOCK_CREATE_RULESET_VERSION
    fs_all=FS_EXECUTE|FS_WRITE_FILE|FS_READ_FILE|FS_READ_DIR|FS_REMOVE_DIR|FS_REMOVE_FILE|FS_MAKE_CHAR|FS_MAKE_DIR|FS_MAKE_REG|FS_MAKE_SOCK|FS_MAKE_FIFO|FS_MAKE_BLOCK|FS_MAKE_SYM
    if abi>=2: fs_all|=FS_REFER
    if abi>=3: fs_all|=FS_TRUNCATE
    if abi>=5: fs_all|=FS_IOCTL_DEV
    net=(NET_BIND_TCP|NET_CONNECT_TCP) if (no_net and abi>=4) else 0
    attr=RulesetAttr(fs_all,net)
    size=ctypes.sizeof(attr) if abi>=4 else 8
    fd=sc(SYS_create,ctypes.byref(attr),size,0)
    def allow(path,access):
        pfd=os.open(path,os.O_PATH|os.O_CLOEXEC)
        try: sc(SYS_add,fd,1,ctypes.byref(PathBeneath(access,pfd)),0)
        finally: os.close(pfd)
    allow("/",FS_EXECUTE|FS_READ_FILE|FS_READ_DIR)             # read + exec everywhere
    for p in ("/dev/null","/dev/zero","/dev/urandom","/dev/tty","/dev/pts"):
        if os.path.exists(p): allow(p,FS_READ_FILE|FS_WRITE_FILE)
    allow("/proc",FS_READ_FILE|FS_READ_DIR|FS_WRITE_FILE)   # inner bwrap writes /proc/self/{uid_map,gid_map,setgroups}
    for p in rw+["/tmp"]:
        if os.path.exists(p): allow(p,fs_all)
    # net: with handled_access_net set and no NET_PORT rules, all TCP bind/connect is denied
    libc.prctl(38,1,0,0,0)  # PR_SET_NO_NEW_PRIVS
    sc(SYS_restrict,fd,0); os.close(fd)
    print(f"[landlock] abi={abi} rw={rw} no_net={no_net}",file=sys.stderr,flush=True)
    os.execvp(cmd[0],cmd)
main()
