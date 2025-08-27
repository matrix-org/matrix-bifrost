#!/bin/bash
pip3 install towncrier==22.8.0
python3 -m towncrier.check --compare-with=origin/develop
