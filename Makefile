# Thin wrapper around tasks.py so `make <task>` and `python tasks.py <task>` agree.
.PHONY: setup data mock serve web check test train explain experiments db

setup data mock serve web check test train explain experiments db:
	python tasks.py $@
