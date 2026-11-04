"""Cisco Packet Tracer .pkt container codec (PT 8.x/9.x and legacy XOR files)."""
import hmac
import struct
import zlib

from ._vendor.twofish_py import Twofish

_KEY = bytes([0x89]) * 16
_IV = bytes([0x10]) * 16
_MAX_XML_SIZE = 32 * 1024 * 1024
_MAX_PKT_SIZE = 16 * 1024 * 1024


def _xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def _dbl(block):
    value = int.from_bytes(block, 'big')
    return (((value << 1) & ((1 << 128) - 1)) ^ (0x87 if value >> 127 else 0)).to_bytes(16, 'big')


class _EAX:
    def __init__(self, cipher):
        self.encrypt_block = cipher.encrypt
        subkey1 = _dbl(self.encrypt_block(bytes(16)))
        self.subkey1 = subkey1
        self.subkey2 = _dbl(subkey1)

    def cmac(self, domain, data=b''):
        content = bytes(15) + bytes([domain]) + data
        blocks = [content[i:i + 16] for i in range(0, len(content), 16)]
        if len(blocks[-1]) == 16:
            blocks[-1] = _xor(blocks[-1], self.subkey1)
        else:
            tail = blocks[-1] + b'\x80' + bytes(15 - len(blocks[-1]))
            blocks[-1] = _xor(tail, self.subkey2)
        state = bytes(16)
        for block in blocks:
            state = self.encrypt_block(_xor(state, block))
        return state

    def crypt(self, data, nonce):
        counter = bytearray(nonce)
        output = bytearray()
        for offset in range(0, len(data), 16):
            block = data[offset:offset + 16]
            stream = self.encrypt_block(bytes(counter))
            output.extend(_xor(block, stream[:len(block)]))
            for index in range(15, -1, -1):
                counter[index] = (counter[index] + 1) & 0xFF
                if counter[index]:
                    break
        return bytes(output)

    def tag(self, nonce, ciphertext):
        return _xor(_xor(nonce, self.cmac(1)), self.cmac(2, ciphertext))


def _read_qcompress(payload):
    if len(payload) < 6:
        raise ValueError('Isi file .pkt terlalu pendek')
    expected_size = struct.unpack('>I', payload[:4])[0]
    if not 0 < expected_size <= _MAX_XML_SIZE:
        raise ValueError('Ukuran XML dalam file .pkt tidak valid atau terlalu besar')
    inflater = zlib.decompressobj()
    xml = inflater.decompress(payload[4:], _MAX_XML_SIZE + 1)
    if len(xml) > _MAX_XML_SIZE or inflater.unconsumed_tail or not inflater.eof:
        raise ValueError('Data terkompresi dalam file .pkt tidak valid atau terlalu besar')
    if inflater.unused_data or len(xml) != expected_size:
        raise ValueError('Ukuran XML file .pkt tidak cocok')
    return xml


def decode_pkt(data):
    """Decode a native Packet Tracer save to XML bytes; reject failed EAX tags."""
    data = bytes(data)
    if len(data) > _MAX_PKT_SIZE:
        raise ValueError('File .pkt terlalu besar')
    if len(data) < 22:
        raise ValueError('File .pkt terlalu kecil')

    size = len(data)
    scrambled = bytes(data[size - 1 - i] ^ ((size - i * size) & 0xFF) for i in range(size))
    ciphertext, tag = scrambled[:-16], scrambled[-16:]
    eax = _EAX(Twofish(_KEY))
    nonce = eax.cmac(0, _IV)
    if not hmac.compare_digest(eax.tag(nonce, ciphertext), tag):
        return _decode_legacy(data)
    payload = eax.crypt(ciphertext, nonce)
    payload = bytes(byte ^ ((len(payload) - i) & 0xFF) for i, byte in enumerate(payload))
    return _read_qcompress(payload)


def _decode_legacy(data):
    output = bytes((byte ^ ((len(data) - i) & 0xFF)) for i, byte in enumerate(data))
    return _read_qcompress(output)


def encode_pkt(xml):
    """Encode UTF-8 Packet Tracer XML using the PT 8.x/9.x save container."""
    xml = xml.encode('utf-8') if isinstance(xml, str) else bytes(xml)
    if not 0 < len(xml) <= _MAX_XML_SIZE:
        raise ValueError('Ukuran XML Packet Tracer tidak valid atau terlalu besar')
    payload = struct.pack('>I', len(xml)) + zlib.compress(xml)
    payload = bytes(byte ^ ((len(payload) - i) & 0xFF) for i, byte in enumerate(payload))
    eax = _EAX(Twofish(_KEY))
    nonce = eax.cmac(0, _IV)
    ciphertext = eax.crypt(payload, nonce)
    scrambled = ciphertext + eax.tag(nonce, ciphertext)
    size = len(scrambled)
    output = bytearray(size)
    for index, byte in enumerate(scrambled):
        output[size - 1 - index] = byte ^ ((size - index * size) & 0xFF)
    if len(output) > _MAX_PKT_SIZE:
        raise ValueError('File .pkt terlalu besar')
    return bytes(output)
