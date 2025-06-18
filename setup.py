from setuptools import setup, find_packages

setup(
  name="meta-dawg",
  version="0.1.0",
  author="Neha Sontakke",
  license="MIT",
  packages=find_packages(),
  install_requires=[
    "pandas>=1.5",
    "numpy>=1.23",
    # etc.
  ],
  entry_points={
    "console_scripts": [
      "meta-dawg=meta_dawg.module_detection:main",
    ],
  },
)

