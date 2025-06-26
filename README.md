# BLIMMP

conda create -n something

cd BLIMMP

pip install .

python META_DAWG/module_detection.py -h

python META_DAWG/module_detection.py ./Examples/example.domtblout \
	--format domtblout \
    -c 0.5 \
    --output example_name
