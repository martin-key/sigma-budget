# The pinned environment of the data processing (docs/approach-specification.md, section 5.2): Python 3.12.10 on Debian bookworm
# by digest, the dependencies of pipeline/requirements.lock with their hashes, UTC, C.UTF-8 and a fixed hash seed.
#
#   docker build -t sigma-budget-data pipeline
#   docker run --rm -v "$PWD":/repo sigma-budget-data python -m budget_pipeline.build.rebuild --build-date 2026-11-05
#   docker run --rm -v "$PWD":/repo sigma-budget-data python -m budget_pipeline.validate.datasets
#
# The image holds only the environment: the repository, with data/originals and data/cache in place, is mounted at /repo.
# git is there for rebuild.py, which reads the wording of the tags mock-v2 and mock-v4 (it does not change any output byte).
FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db

ENV PYTHONPATH=/repo/pipeline TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 PYTHONHASHSEED=0 PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory /repo

COPY requirements.lock /tmp/requirements.lock
RUN pip install --require-hashes --no-deps -r /tmp/requirements.lock && rm /tmp/requirements.lock

WORKDIR /repo
