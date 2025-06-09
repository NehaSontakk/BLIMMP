
# BATHsearch Tutorial

**BATHsearch** annotates FASTA files with corresponding KEGG orthology (KO) numbers using HMMs from KOfamDB.

---

## Prerequisites

- **BATH** suite installed (includes `bathconvert` and `bathsearch`).
- **Prodigal** installed for ORF calling.
- **Tantan** installed for repeat masking.
- A copy of the KOfamDB HMM profiles (download link below).

---

## 1. Preprocessing HMMs

1. **Convert each `.hmm` to a BATH-compatible database**  
   ```bash
   bathconvert
   ```

2. **Merge all `.bhmm` files** into one database:

   ```bash
   cat *.bhmm > All_KOfamDB_Jan2025.bhmm
   ```
3. **(Re)Generate after database updates**

   * If KOfamDB has changed since January 2025, re-download the profiles:

     ```bash
     wget -O kofam_profiles.tar.gz https://www.genome.jp/ftp/db/kofam/ko_list.gz
     # adjust per KOfamDB instructions…
     ```
   * Repeat steps 1–2 on the new `.hmm` files.
   * Specify the new DB when running BATH:

     ```bash
     export BATH_DB=/path/to/All_KOfamDB_<newdate>.bhmm
     ```

---

## 2. Running `bathsearch`

### A. On an HPC with SLURM (sbatch)

```bash
COMMAND TBA
```

> **ETA:** Roughly 1–2 h for a 100 MB genome, depending on CPU count.

### B. On a Local Machine

```bash
COMMAND TBA
```

> **ETA:** \~30 min for a 50 MB FASTA on 4 CPUs.

---

## 3. What Does `bathsearch` Do?

* **ORF detection**
  Uses Prodigal to call coding regions (speeds up HMM scans on DNA).
* **Tantan masking**
  Screens low-complexity and repeat regions that can confound HMM matches.
* **HMM scan & KO assignment**
  Directly scans DNA, tolerates frameshifts and detects partial domains.

> **Why BATHsearch?**
>
> * Frameshift-robust
> * Domain-only detection
> * DNA-level scanning (no translation needed)

---

## 4. Further Reading

* Wheeler TJ, Eddy SR. “**BATHsearch**: domain‐level HMM searches on unassembled reads.” *Bioinformatics Advances* **4**(1), 2024.
  [https://academic.oup.com/bioinformaticsadvances/article/4/1/vbae088/7693713](https://academic.oup.com/bioinformaticsadvances/article/4/1/vbae088/7693713)
* Official BATH user guide & tutorial:
  [https://github.com/TravisWheelerLab/BATH/blob/main/documentation/userguide/tutorial.md](https://github.com/TravisWheelerLab/BATH/blob/main/documentation/userguide/tutorial.md)

---
