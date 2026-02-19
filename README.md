# Listening Machines

Some things to install:

1) An IDE (VSCode, Cursor, etc.). Terminal is fine too but you will need a way to load/run [Jupyter Notebooks](https://jupyter.org/).

## Installation

- Install [uv](https://docs.astral.sh/uv/)

- On your local machine, Clone this repo and then change into this repo's directory

    `git clone https://github.com/johanndiedrick/listening_machines`

    `cd listening_machines`

- Create a new environment, activate your environment, and install the required libraries:

    `uv venv`

    `source .venv/bin/activate`

    `uv pip install -r requirements.txt -p .venv`

    `uv run -p .venv python -m ipykernel install --user --name listening-machines --display-name "Python (.venv listening_machines)"`

- You should now be able to run the cells in the notebook after selecting the kernel named `listening_machines`. Restart your IDE if necessary.

- Optional: Configure notebook for output stripping: (could also use `pre-commit` down the line...)

    `nbstripout --install`

## Troubleshooting

### llvmlite / numba / librosa fails to install (e.g. "Could not find LLVM" or "Failed to build llvmlite")

uv may be building llvmlite from source instead of using a pre-built wheel. Try in order:

1. **Force using pre-built wheels only** (no build from source):

   `uv pip install --only-binary=:all: llvmlite numba -p .venv`  
   `uv pip install -r requirements.txt -p .venv`

   If that fails with “no matching distribution”, there’s no wheel for your platform; go to step 3.

2. **Clear uv’s cache and reinstall** (often fixes wheel selection):

   `uv cache clean llvmlite`  
   `uv pip install llvmlite numba -p .venv`  
   `uv pip install -r requirements.txt -p .venv`

3. **If it still builds from source and fails on macOS**, install LLVM and point the build at it. **`LLVM_DIR` must be set in the same shell where you run `uv pip install`** (or use the one-line form below).

   Install LLVM:

   `brew install llvm`

   Check that the path exists (should list `LLVMConfig.cmake`):

   `ls $(brew --prefix llvm)/lib/cmake/llvm`

   Then install with LLVM visible to the build (one line so the env var is set for that command):

   `LLVM_DIR=$(brew --prefix llvm)/lib/cmake/llvm uv pip install llvmlite numba -p .venv`  
   `uv pip install -r requirements.txt -p .venv`