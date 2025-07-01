from setuptools import setup, find_packages

setup(
  name="BLIMMP",
  version="0.1.0",
  author="Neha Sontakke",
  license="MIT",
  packages=find_packages(),
  install_requires=[
    "pandas>=1.5",
    "numpy>=1.23"
  ],
  entry_points={
    "console_scripts": [
      "BLIMMP=BLIMMP_Scripts.module_detection:main",
    ],
  },
)

