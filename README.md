# Travel Itinerary Planner

A small Python project that generates a travel itinerary based on a city and user interests.

## Project layout

- `app.py`: Application entrypoint
- `src/`: Main package
  - `src/core/planner.py`: Core planning logic
  - `src/chains/itinerary_chain.py`: LLM chain / itinerary generation
  - `src/config/config.py`: Configuration handling
  - `src/utils/logger.py`: Logging utilities
  - `src/utils/custom_exception.py`: Custom exception types
- `uv.lock`, `pyproject.toml`: Dependency management (uv)
- `logs/`: Log output directory

## Requirements

- Python (use the version declared in `pyproject.toml`)
- `uv` (Astral) for dependency install (recommended)
- Optional: Docker

## Setup (local, using uv)

1. Create a virtual environment:
   - `uv venv`

2. Install dependencies (locked):
   - `uv sync --frozen`

3. Run the app:
   - `uv run python app.py`

## Configuration

Configuration can be located/managed in `src/config/config.py`.

If the project needs API keys (for an LLM provider), export them as environment variables before running, for example:

- `export GROQ_API_KEY=...`

(Use the variable names expected by your implementation in `src/config/config.py` and `src/chains/itinerary_chain.py`.)

## Logging

Logs are written under `logs/`.

## Docker (two-stage, builder uses Astral uv image)

A typical two-stage build for dependency syncing, then copies the virtualenv into a slim runtime image.

### Build

- `docker build -t travel-itinerary-planner:latest .`

### Run

- `docker run --rm -p 8501:8501 -e GROQ_API_KEY=... travel-itinerary-planner:latest`

## Development notes

- Source code lives in `src/`.
- If you change dependencies, update `pyproject.toml` and regenerate `uv.lock` with uv tooling.
- Keep secrets out of the repository; use environment variables instead.


