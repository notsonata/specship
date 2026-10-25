FROM python:3.12-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
ARG SWEBENCH_VERSION=5.0.2
RUN pip install --no-cache-dir swebench==${SWEBENCH_VERSION}
WORKDIR /evaluation
ENTRYPOINT ["python", "-m", "swebench.harness.run_evaluation"]
