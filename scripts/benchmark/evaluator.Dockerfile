FROM python:3.12-bookworm
ARG SWEBENCH_VERSION=5.0.2
RUN pip install --no-cache-dir swebench==${SWEBENCH_VERSION}
WORKDIR /evaluation
ENTRYPOINT ["python", "-m", "swebench.harness.run_evaluation"]
