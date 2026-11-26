"""Builds the invalid/blank/encrypted/truncated fixtures used by the robustness suites.
Usage: python3 test/fixtures/build-robustness.py [OUT_DIR]   (default /tmp/rob; set ROB_DIR for the tests)
Needs pypdf and qpdf. Every file is a real file; the suites fail if one is missing."""
import os, shutil, subprocess, sys
from pypdf import PdfWriter, PdfReader
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/rob"
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(OUT, exist_ok=True)
def w(name, data, mode="wb"):
    open(os.path.join(OUT, name), mode).write(data)
w("garbage.pdf", os.urandom(4096))
w("zero.pdf", b"")
w("fake.pdf", "This is plain text with a .pdf name. It is not a PDF file at all.\n", "w")
for src, dst in (("sample.pdf", "truncated.pdf"), ("scanned-en.pdf", "truncated-scan.pdf")):
    d = open(os.path.join(FIX, src), "rb").read(); w(dst, d[: len(d) // 2])
b = PdfWriter(); b.add_blank_page(612, 792); b.add_blank_page(612, 792)
b.write(os.path.join(OUT, "blank.pdf"))
def enc(name, user_pw, owner_pw):
    r = PdfWriter(clone_from=os.path.join(FIX, "sample.pdf"))
    r.encrypt(user_password=user_pw, owner_password=owner_pw, algorithm="AES-256")
    r.write(os.path.join(OUT, name))
enc("encrypted-user.pdf", "secret", "owner")   # needs a password to open
enc("encrypted-owner-only.pdf", "", "owner")        # opens without a password (owner-password only)
w("empty.html", "<html><head><script>var a = 1;</script></head><body><script>var b = 2;</script></body></html>", "w")
w("spaces.txt", "   \n\t  \n   ", "w")
print("built in", OUT, sorted(os.listdir(OUT)))
