#!/usr/bin/env python3
"""
Genera classes.dex para Hydroloop BGA sin Android SDK.

Contiene las clases co.hydroloop.bga.MainActivity y co.hydroloop.bga.Chooser
(ver ../java/ para el código Java equivalente), escritas como bytecode Dalvik
y empaquetadas en formato DEX 035.

Uso:  python3 build_dex.py salida/classes.dex
"""
import hashlib, struct, sys, zlib

NO_INDEX = 0xFFFFFFFF

# ---------------------------------------------------------------- utilidades
def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return bytes(out)

def sleb(n):
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        done = (n == 0 and not b & 0x40) or (n == -1 and b & 0x40)
        out.append(b if done else b | 0x80)
        if done: return bytes(out)

def mutf8(s):
    out = bytearray()
    for ch in s:
        c = ord(ch)
        if c == 0: out += b'\xc0\x80'
        elif c < 0x80: out.append(c)
        elif c < 0x800: out += bytes([0xC0 | c >> 6, 0x80 | c & 0x3F])
        elif c < 0x10000: out += bytes([0xE0 | c >> 12, 0x80 | (c >> 6) & 0x3F, 0x80 | c & 0x3F])
        else: raise ValueError('carácter fuera de BMP')
    return bytes(out)

def shorty(t):
    return 'L' if t[0] in 'L[' else t

# ---------------------------------------------------------------- referencias
class M:   # referencia a método
    def __init__(self, cls, name, ret, *params): self.cls, self.name, self.ret, self.params = cls, name, ret, tuple(params)
    def key(self): return (self.cls, self.name, self.ret, self.params)
class F:   # referencia a campo
    def __init__(self, cls, name, typ): self.cls, self.name, self.typ = cls, name, typ
    def key(self): return (self.cls, self.name, self.typ)
class T:   # referencia a tipo
    def __init__(self, d): self.d = d
class S:   # referencia a string
    def __init__(self, s): self.s = s

# ---------------------------------------------------------------- ensamblador
# Cada instrucción es una tupla (opcode_name, args...). Etiquetas: ('label', 'nombre').
OPS = {
    'return-void': (0x0e, '10x'), 'return': (0x0f, '11x'),
    'move-result': (0x0a, '11x'), 'move-result-object': (0x0c, '11x'),
    'const/4': (0x12, '11n'), 'const/16': (0x13, '21s'),
    'const-string': (0x1a, '21c'), 'new-instance': (0x22, '21c'),
    'sget': (0x60, '21c'), 'sget-object': (0x62, '21c'),
    'new-array': (0x23, '22c'), 'iget-object': (0x54, '22c'), 'iput-object': (0x5b, '22c'),
    'aput-object': (0x4d, '23x'),
    'if-eqz': (0x38, '21t'), 'if-nez': (0x39, '21t'),
    'if-ne': (0x33, '22t'), 'if-lt': (0x34, '22t'),
    'goto': (0x28, '10t'),
    'invoke-virtual': (0x6e, '35c'), 'invoke-super': (0x6f, '35c'), 'invoke-direct': (0x70, '35c'),
    'invoke-static': (0x71, '35c'), 'invoke-interface': (0x72, '35c'),
}
SIZE = {'10x': 1, '11x': 1, '11n': 1, '10t': 1, '21s': 2, '21c': 2, '22c': 2, '23x': 2, '21t': 2, '22t': 2, '35c': 3}

def refs_of(code):
    for ins in code:
        for a in ins[1:]:
            if isinstance(a, (M, F, T, S)): yield a

def assemble(code, idx):
    """idx: funciones string/type/field/method -> índice. Devuelve (lista u16, mapa etiqueta->dirección)."""
    labels, pc = {}, 0
    for ins in code:
        if ins[0] == 'label': labels[ins[1]] = pc
        else: pc += SIZE[OPS[ins[0]][1]]
    out, pc = [], 0
    def reg4(r):
        assert 0 <= r < 16, r; return r
    for ins in code:
        if ins[0] == 'label': continue
        op, fmt = OPS[ins[0]]; a = ins[1:]
        if fmt == '10x': out += [op]
        elif fmt == '11x': assert a[0] < 256; out += [op | a[0] << 8]
        elif fmt == '11n':
            assert -8 <= a[1] <= 7; out += [op | reg4(a[0]) << 8 | (a[1] & 0xF) << 12]
        elif fmt == '21s': assert -32768 <= a[1] < 32768; out += [op | a[0] << 8, a[1] & 0xFFFF]
        elif fmt == '21c':
            r = a[1]
            i = idx['s'](r.s) if isinstance(r, S) else idx['t'](r.d) if isinstance(r, T) else idx['f'](r)
            out += [op | a[0] << 8, i]
        elif fmt == '22c':
            r = a[2]; i = idx['t'](r.d) if isinstance(r, T) else idx['f'](r)
            out += [op | reg4(a[0]) << 8 | reg4(a[1]) << 12, i]
        elif fmt == '23x': out += [op | a[0] << 8, a[1] | a[2] << 8]   # vAA, vBB(array), vCC(índice)
        elif fmt == '21t':
            off = labels[a[1]] - pc; out += [op | a[0] << 8, off & 0xFFFF]
        elif fmt == '22t':
            off = labels[a[2]] - pc; out += [op | reg4(a[0]) << 8 | reg4(a[1]) << 12, off & 0xFFFF]
        elif fmt == '10t':
            off = labels[a[0]] - pc; assert -128 <= off < 128; out += [op | (off & 0xFF) << 8]
        elif fmt == '35c':
            regs, m = a[0], a[1]; assert len(regs) <= 5
            r = list(regs) + [0] * (5 - len(regs))
            g = r[4]
            out += [op | g << 8 | len(regs) << 12, idx['m'](m), r[0] | r[1] << 4 | r[2] << 8 | r[3] << 12]
        pc += SIZE[fmt]
    return out, labels

# ---------------------------------------------------------------- tipos usados
ACT   = 'Landroid/app/Activity;'
MAIN  = 'Lco/hydroloop/bga/MainActivity;'
CHO   = 'Lco/hydroloop/bga/Chooser;'
WV    = 'Landroid/webkit/WebView;'
WS    = 'Landroid/webkit/WebSettings;'
WVC   = 'Landroid/webkit/WebViewClient;'
WCC   = 'Landroid/webkit/WebChromeClient;'
FCP   = 'Landroid/webkit/WebChromeClient$FileChooserParams;'
VCB   = 'Landroid/webkit/ValueCallback;'
URI   = 'Landroid/net/Uri;'
INT   = 'Landroid/content/Intent;'
CR    = 'Landroid/content/ContentResolver;'
CV    = 'Landroid/content/ContentValues;'
STR   = 'Ljava/lang/String;'
OBJ   = 'Ljava/lang/Object;'

F_WEB = F(MAIN, 'web', WV)
F_CB  = F(MAIN, 'cb', VCB)
F_CAM = F(MAIN, 'camUri', URI)
F_A   = F(CHO, 'a', MAIN)

# ---------------------------------------------------------------- MainActivity
main_init = [
    ('invoke-direct', (0,), M(ACT, '<init>', 'V')),
    ('return-void',),
]
# registros: v0-v2 locales, v3 = this, v4 = bundle
main_onCreate = [
    ('invoke-super', (3, 4), M(ACT, 'onCreate', 'V', 'Landroid/os/Bundle;')),
    ('new-instance', 0, T(WV)),
    ('invoke-direct', (0, 3), M(WV, '<init>', 'V', 'Landroid/content/Context;')),
    ('iput-object', 0, 3, F_WEB),
    ('invoke-virtual', (0,), M(WV, 'getSettings', WS)),
    ('move-result-object', 1),
    ('const/4', 2, 1),
    ('invoke-virtual', (1, 2), M(WS, 'setJavaScriptEnabled', 'V', 'Z')),
    ('invoke-virtual', (1, 2), M(WS, 'setDomStorageEnabled', 'V', 'Z')),
    ('invoke-virtual', (1, 2), M(WS, 'setAllowFileAccess', 'V', 'Z')),
    ('new-instance', 1, T(WVC)),
    ('invoke-direct', (1,), M(WVC, '<init>', 'V')),
    ('invoke-virtual', (0, 1), M(WV, 'setWebViewClient', 'V', WVC)),
    ('new-instance', 1, T(CHO)),
    ('invoke-direct', (1, 3), M(CHO, '<init>', 'V', MAIN)),
    ('invoke-virtual', (0, 1), M(WV, 'setWebChromeClient', 'V', WCC)),
    ('const-string', 1, S('file:///android_asset/index.html')),
    ('invoke-virtual', (0, 1), M(WV, 'loadUrl', 'V', STR)),
    ('invoke-virtual', (3, 0), M(ACT, 'setContentView', 'V', 'Landroid/view/View;')),
    ('return-void',),
]
# registros: v0-v1 locales, v2 = this
main_onBack = [
    ('iget-object', 0, 2, F_WEB),
    ('if-eqz', 0, 'super'),
    ('invoke-virtual', (0,), M(WV, 'canGoBack', 'Z')),
    ('move-result', 1),
    ('if-eqz', 1, 'super'),
    ('invoke-virtual', (0,), M(WV, 'goBack', 'V')),
    ('return-void',),
    ('label', 'super'),
    ('invoke-super', (2,), M(ACT, 'onBackPressed', 'V')),
    ('return-void',),
]
# registros: v0-v3 locales, v4 = this, v5 = req, v6 = res, v7 = data
main_onResult = [
    ('invoke-super', (4, 5, 6, 7), M(ACT, 'onActivityResult', 'V', 'I', 'I', INT)),
    ('iget-object', 0, 4, F_CB),                 # v0 = cb
    ('if-eqz', 0, 'end'),
    ('const/4', 1, 0),
    ('iput-object', 1, 4, F_CB),                 # cb = null
    ('invoke-static', (6, 7), M(FCP, 'parseResult', '[' + URI, 'I', INT)),
    ('move-result-object', 1),                   # v1 = r
    ('iget-object', 2, 4, F_CAM),                # v2 = camUri
    ('if-eqz', 2, 'send'),
    ('if-nez', 1, 'delete'),                     # eligió de la galería
    ('const/4', 3, -1),
    ('if-ne', 6, 3, 'delete'),                   # canceló
    ('const/4', 3, 1),
    ('new-array', 1, 3, T('[' + URI)),           # r = new Uri[1]
    ('const/4', 3, 0),
    ('aput-object', 2, 1, 3),                    # r[0] = camUri
    ('goto', 'clear'),
    ('label', 'delete'),
    ('label', 'try1_start'),
    ('invoke-virtual', (4,), M(ACT, 'getContentResolver', CR)),
    ('move-result-object', 3),
    ('const/4', 5, 0),
    ('invoke-virtual', (3, 2, 5, 5), M(CR, 'delete', 'I', URI, STR, '[' + STR)),
    ('label', 'try1_end'),
    ('label', 'clear'),
    ('const/4', 3, 0),
    ('iput-object', 3, 4, F_CAM),                # camUri = null
    ('label', 'send'),
    ('invoke-interface', (0, 1), M(VCB, 'onReceiveValue', 'V', OBJ)),
    ('label', 'end'),
    ('return-void',),
]

# ---------------------------------------------------------------- Chooser
cho_init = [
    ('invoke-direct', (0,), M(WCC, '<init>', 'V')),
    ('iput-object', 1, 0, F_A),
    ('return-void',),
]
# registros: v0-v5 locales, v6 = this, v7 = webView, v8 = callback, v9 = params
cho_onShow = [
    ('iget-object', 0, 6, F_A),                  # v0 = actividad
    ('iget-object', 1, 0, F_CB),
    ('if-eqz', 1, 'l1'),
    ('const/4', 2, 0),
    ('invoke-interface', (1, 2), M(VCB, 'onReceiveValue', 'V', OBJ)),
    ('label', 'l1'),
    ('iput-object', 8, 0, F_CB),                 # a.cb = callback
    ('const/4', 1, 0),
    ('iput-object', 1, 0, F_CAM),                # a.camUri = null
    ('invoke-virtual', (9,), M(FCP, 'createIntent', INT)),
    ('move-result-object', 1),
    ('const-string', 2, S('Foto de la factura')),
    ('invoke-static', (1, 2), M(INT, 'createChooser', INT, INT, 'Ljava/lang/CharSequence;')),
    ('move-result-object', 1),                   # v1 = chooser
    ('sget', 2, F('Landroid/os/Build$VERSION;', 'SDK_INT', 'I')),
    ('const/16', 3, 29),
    ('if-lt', 2, 3, 'start'),
    ('label', 'try2_start'),
    ('invoke-virtual', (0,), M(ACT, 'getContentResolver', CR)),
    ('move-result-object', 2),
    ('sget-object', 3, F('Landroid/provider/MediaStore$Images$Media;', 'EXTERNAL_CONTENT_URI', URI)),
    ('new-instance', 4, T(CV)),
    ('invoke-direct', (4,), M(CV, '<init>', 'V')),
    ('invoke-virtual', (2, 3, 4), M(CR, 'insert', URI, URI, CV)),
    ('move-result-object', 2),                   # v2 = uri
    ('if-eqz', 2, 'start'),
    ('iput-object', 2, 0, F_CAM),
    ('new-instance', 3, T(INT)),
    ('const-string', 4, S('android.media.action.IMAGE_CAPTURE')),
    ('invoke-direct', (3, 4), M(INT, '<init>', 'V', STR)),
    ('const-string', 4, S('output')),
    ('invoke-virtual', (3, 4, 2), M(INT, 'putExtra', INT, STR, 'Landroid/os/Parcelable;')),
    ('const/4', 4, 3),
    ('invoke-virtual', (3, 4), M(INT, 'addFlags', INT, 'I')),
    ('const/4', 4, 1),
    ('new-array', 4, 4, T('[' + INT)),
    ('const/4', 5, 0),
    ('aput-object', 3, 4, 5),
    ('const-string', 5, S('android.intent.extra.INITIAL_INTENTS')),
    ('invoke-virtual', (1, 5, 4), M(INT, 'putExtra', INT, STR, '[Landroid/os/Parcelable;')),
    ('label', 'try2_end'),
    ('label', 'start'),
    ('const/4', 2, 1),
    ('invoke-virtual', (0, 1, 2), M(ACT, 'startActivityForResult', 'V', INT, 'I')),
    ('return', 2),
    ('label', 'catch2'),
    ('const/4', 2, 0),
    ('iput-object', 2, 0, F_CAM),
    ('goto', 'start'),
]

ACC_PUBLIC, ACC_PROTECTED, ACC_CONSTRUCTOR = 0x1, 0x4, 0x10000
CLASSES = [
    dict(name=MAIN, super=ACT, fields=[F_WEB, F_CB, F_CAM], methods=[
        dict(ref=M(MAIN, '<init>', 'V'), acc=ACC_PUBLIC | ACC_CONSTRUCTOR, regs=1, ins=1, outs=1, code=main_init),
        dict(ref=M(MAIN, 'onCreate', 'V', 'Landroid/os/Bundle;'), acc=ACC_PROTECTED, regs=5, ins=2, outs=2, code=main_onCreate),
        dict(ref=M(MAIN, 'onBackPressed', 'V'), acc=ACC_PUBLIC, regs=3, ins=1, outs=1, code=main_onBack),
        dict(ref=M(MAIN, 'onActivityResult', 'V', 'I', 'I', INT), acc=ACC_PROTECTED, regs=8, ins=4, outs=4,
             code=main_onResult, tries=[('try1_start', 'try1_end', 'clear')]),
    ]),
    dict(name=CHO, super=WCC, fields=[F_A], methods=[
        dict(ref=M(CHO, '<init>', 'V', MAIN), acc=ACC_PUBLIC | ACC_CONSTRUCTOR, regs=2, ins=2, outs=1, code=cho_init),
        dict(ref=M(CHO, 'onShowFileChooser', 'Z', WV, VCB, FCP), acc=ACC_PUBLIC, regs=10, ins=4, outs=3,
             code=cho_onShow, tries=[('try2_start', 'try2_end', 'catch2')]),
    ]),
]

# ---------------------------------------------------------------- recolección de ids
def build():
    strings, types, protos, fields, methods = set(), set(), set(), set(), set()
    def add_type(t): types.add(t); strings.add(t)
    def add_proto(ret, params):
        protos.add((ret, params)); strings.add(shorty(ret) + ''.join(shorty(p) for p in params))
        add_type(ret); [add_type(p) for p in params]
    def add_field(f): fields.add(f.key()); add_type(f.cls); add_type(f.typ); strings.add(f.name)
    def add_method(m): methods.add(m.key()); add_type(m.cls); strings.add(m.name); add_proto(m.ret, m.params)
    for c in CLASSES:
        add_type(c['name']); add_type(c['super'])
        for f in c['fields']: add_field(f)
        for md in c['methods']:
            add_method(md['ref'])
            for r in refs_of(md['code']):
                if isinstance(r, M): add_method(r)
                elif isinstance(r, F): add_field(r)
                elif isinstance(r, T): add_type(r.d)
                elif isinstance(r, S): strings.add(r.s)

    s_list = sorted(strings, key=lambda s: [ord(ch) for ch in s])
    s_idx = {s: i for i, s in enumerate(s_list)}
    t_list = sorted(types, key=lambda t: s_idx[t])
    t_idx = {t: i for i, t in enumerate(t_list)}
    p_list = sorted(protos, key=lambda p: (t_idx[p[0]], [t_idx[x] for x in p[1]]))
    p_idx = {p: i for i, p in enumerate(p_list)}
    f_list = sorted(fields, key=lambda f: (t_idx[f[0]], s_idx[f[1]], t_idx[f[2]]))
    f_idx = {f: i for i, f in enumerate(f_list)}
    m_list = sorted(methods, key=lambda m: (t_idx[m[0]], s_idx[m[1]], p_idx[(m[2], m[3])]))
    m_idx = {m: i for i, m in enumerate(m_list)}
    idx = dict(s=lambda s: s_idx[s], t=lambda t: t_idx[t], f=lambda f: f_idx[f.key()], m=lambda m: m_idx[m.key()])

    # ------------------------------------------------------------ disposición
    HDR = 0x70
    off = HDR
    string_ids_off = off; off += 4 * len(s_list)
    type_ids_off = off;   off += 4 * len(t_list)
    proto_ids_off = off;  off += 12 * len(p_list)
    field_ids_off = off;  off += 8 * len(f_list)
    method_ids_off = off; off += 8 * len(m_list)
    class_defs_off = off; off += 32 * len(CLASSES)
    data_off = off

    data = bytearray()
    def align(n):
        while (data_off + len(data)) % n: data.append(0)
    def here(): return data_off + len(data)

    # type_lists (parámetros de protos)
    align(4)
    tl_off, tl_count = {}, 0
    type_list_start = here()
    for p in p_list:
        params = p[1]
        if params and params not in tl_off:
            align(4); tl_off[params] = here(); tl_count += 1
            data += struct.pack('<I', len(params)) + b''.join(struct.pack('<H', t_idx[x]) for x in params)
    # string_data
    string_data_start = here()
    sd_off = []
    for s in s_list:
        sd_off.append(here())
        data += uleb(len(s.encode('utf-16-le')) // 2) + mutf8(s) + b'\x00'
    # code_items
    align(4)
    code_start = here()
    code_off, code_count = {}, 0
    for c in CLASSES:
        for md in c['methods']:
            align(4)
            insns, labels = assemble(md['code'], idx)
            tries = md.get('tries', [])
            code_off[md['ref'].key()] = here(); code_count += 1
            data += struct.pack('<HHHHII', md['regs'], md['ins'], md['outs'], len(tries), 0, len(insns))
            data += b''.join(struct.pack('<H', u) for u in insns)
            if tries:
                if len(insns) % 2: data += b'\x00\x00'
                # una lista de handlers: cada try tiene su propio catch-all
                handlers, h_offs = bytearray(uleb(len(tries))), []
                for (_, _, h) in tries:
                    h_offs.append(len(handlers))
                    handlers += sleb(0) + uleb(labels[h])     # 0 tipos + catch-all
                for (st, en, _), ho in zip(tries, h_offs):
                    data += struct.pack('<IHH', labels[st], labels[en] - labels[st], ho)
                data += handlers
    # class_data
    class_data_start = here()
    cd_off = {}
    for c in CLASSES:
        cd_off[c['name']] = here()
        inst = sorted(f_idx[f.key()] for f in c['fields'])
        direct = sorted((m_idx[md['ref'].key()], md) for md in c['methods'] if md['ref'].name == '<init>')
        virtual = sorted((m_idx[md['ref'].key()], md) for md in c['methods'] if md['ref'].name != '<init>')
        data += uleb(0) + uleb(len(inst)) + uleb(len(direct)) + uleb(len(virtual))
        prev = 0
        for fi in inst:
            data += uleb(fi - prev) + uleb(ACC_PUBLIC); prev = fi
        for group in (direct, virtual):
            prev = 0
            for mi, md in group:
                data += uleb(mi - prev) + uleb(md['acc']) + uleb(code_off[md['ref'].key()]); prev = mi
    # map_list
    align(4)
    map_off = here()
    items = [
        (0x0000, 1, 0), (0x0001, len(s_list), string_ids_off), (0x0002, len(t_list), type_ids_off),
        (0x0003, len(p_list), proto_ids_off), (0x0004, len(f_list), field_ids_off),
        (0x0005, len(m_list), method_ids_off), (0x0006, len(CLASSES), class_defs_off),
    ]
    if tl_count: items.append((0x1001, tl_count, type_list_start))
    items += [(0x2002, len(s_list), string_data_start), (0x2001, code_count, code_start),
              (0x2000, len(CLASSES), class_data_start), (0x1000, 1, map_off)]
    items.sort(key=lambda x: x[2])
    data += struct.pack('<I', len(items)) + b''.join(struct.pack('<HHII', t, 0, n, o) for t, n, o in items)
    align(4)

    # ------------------------------------------------------------ secciones de índices
    body = bytearray()
    body += b''.join(struct.pack('<I', o) for o in sd_off)
    body += b''.join(struct.pack('<I', s_idx[t]) for t in t_list)
    for ret, params in p_list:
        sh = shorty(ret) + ''.join(shorty(x) for x in params)
        body += struct.pack('<III', s_idx[sh], t_idx[ret], tl_off.get(params, 0) if params else 0)
    for cls, name, typ in f_list:
        body += struct.pack('<HHI', t_idx[cls], t_idx[typ], s_idx[name])
    for cls, name, ret, params in m_list:
        body += struct.pack('<HHI', t_idx[cls], p_idx[(ret, params)], s_idx[name])
    for c in CLASSES:
        body += struct.pack('<IIIIIIII', t_idx[c['name']], ACC_PUBLIC, t_idx[c['super']], 0, NO_INDEX, 0, cd_off[c['name']], 0)
    assert HDR + len(body) == data_off

    file_size = data_off + len(data)
    header = bytearray(b'dex\n035\x00' + b'\x00' * 4 + b'\x00' * 20)
    header += struct.pack('<IIIII', file_size, HDR, 0x12345678, 0, 0)          # tamaño, header, endian, link
    header += struct.pack('<I', map_off)
    header += struct.pack('<II', len(s_list), string_ids_off)
    header += struct.pack('<II', len(t_list), type_ids_off)
    header += struct.pack('<II', len(p_list), proto_ids_off)
    header += struct.pack('<II', len(f_list), field_ids_off)
    header += struct.pack('<II', len(m_list), method_ids_off)
    header += struct.pack('<II', len(CLASSES), class_defs_off)
    header += struct.pack('<II', len(data), data_off)
    assert len(header) == HDR
    dex = header + body + data
    dex[12:32] = hashlib.sha1(bytes(dex[32:])).digest()
    dex[8:12] = struct.pack('<I', zlib.adler32(bytes(dex[12:])) & 0xFFFFFFFF)
    return bytes(dex)

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'classes.dex'
    d = build()
    open(out, 'wb').write(d)
    print(f'{out}: {len(d)} bytes')
