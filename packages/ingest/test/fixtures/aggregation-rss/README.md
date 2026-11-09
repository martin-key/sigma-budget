# RSS donor evidence (partial Wave 11)

`donor/feed.py` is the unchanged donor from commit `10697d0def6ff6892029a311e2b590602e66b931` (SHA-256 `2e3a11cc4aa4424470141ba027172b5fda9910f8de8431da054a8e89466e66ed`). `cases.json` is a synthetic input, not a publication or a source reconstruction. The generator loads only the RSS functions from that donor, with unrelated pipeline imports stubbed and a fixed build date. Its Python 3.12 `xml.etree.ElementTree` comparison independently checks parsed XML as well as exact bytes. Run `python3.12 generate_oracle.py --check` from any directory.

This evidence covers RSS serialization only. It does not establish feed event construction, aggregation, final-layer or published-release parity.
