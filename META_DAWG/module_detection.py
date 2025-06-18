# -*- coding: utf-8 -*-

import os
import glob
import pandas as pd
import numpy as np
from math import exp
import json
import argparse

#Process TBL file

def process_tbl(location):
    cols = ['target name','accession','query name','accession.1','hmm len','hmm from','hmm to',
            'seq len','ali from','ali to','env from','env to','E-value','score','bias',
            'shifts','stops','pipe','description of target']
    return pd.read_csv(location, header=None, skiprows=2, skipfooter=8,
                       names=cols, sep=r"\s+", engine='python')

#Process HMM result files                       
def process_domtblout(path):
    cols = [
        'target name', 'target_accession', 'tlen', 'query_name',
        'query_accession', 'qlen', 'full_Evalue', 'full_score',
        'full_bias', 'n_domains', 'of_domains', 'c_Evalue',
        'i_Evalue', 'i_score', 'i_bias', 'hmm from', 'hmm to',
        'ali from', 'ali to', 'env from', 'env to', 'acc', 'description'
    ]

    # skiprows=3 to drop the first 3 lines
    # skipfooter=10 to drop the last 10 lines (requires engine='python')
    df = pd.read_csv(
        path,
        comment='#',
        sep=r'\s+',
        names=cols,
        usecols=[
            'target name','query_name',
            'hmm from','hmm to',
            'ali from','ali to',
            'i_score','i_Evalue'
        ],
        skiprows=3,
        skipfooter=10,
        engine='python'
    )

    df.rename(columns={
        'query_name': 'KO id',
        'i_score':    'score',
        'i_Evalue':   'E-value'
    }, inplace=True)

    # compute inclusive lengths and filter out any zero‐length hits
    df['ali_len'] = abs(df['ali to'] - df['ali from'])
    df['hmm_len'] = abs(df['hmm to'] - df['hmm from'])

    # keep only rows where both alignment lengths are positive
    df = df[(df['ali_len'] > 0) & (df['hmm_len'] > 0)].copy()

    # drop the helper columns
    df.drop(columns=['ali_len','hmm_len'], inplace=True)

    return df              

# Get the clusters/group data

def cluster_strand(df, from_col="ali from", to_col="ali to"):
    # normalize & sort
    df = df.copy()
    df["start"] = df[[from_col,to_col]].min(axis=1)
    df["end"]   = df[[from_col,to_col]].max(axis=1)
    df = df.sort_values("start").reset_index()

    groups = []        # each group: {"id": int, "end": float}
    grp_ids = []       # to collect group-id per row

    for _, row in df.iterrows():
        s,e = row["start"], row["end"]
        length = abs(s-e)
        # try to join an existing group
        for grp in groups:
            if s <= grp["end"]:
                overlap = max(0, min(e, grp["end"]) - max(s, grp["start"]))
                short_len = min(e - s, grp["end"] - grp["start"])
                frac = overlap / short_len
                #print(frac, overlap)
                #print("row",s,e)
                #print("grp",grp["start"],grp["end"])
                if frac >= 0.6:
                  grp_ids.append(grp["id"])
                  grp["start"] = min(grp["start"], s)
                  grp["end"]   = max(grp["end"],   e)
                  break
        else:
            # no overlap → new group
            new_id = len(groups) + 1
            groups.append({"id": new_id, "start":s ,"end": e})
            grp_ids.append(new_id)

    df["grp_id"] = grp_ids
    # restore original order & index
    return df.set_index("index").sort_index()[["grp_id"]]

def assign_overlap_groups(df_hits):
    # 1) strand column
    df = df_hits.copy()
    df["strand"] = np.where(df["ali to"] >= df["ali from"], "+", "-")

    # 2) per‐target, per‐strand clustering
    out = []
    for (tgt, strand), sub in df.groupby(["target name","strand"], sort=False):
        clustered = cluster_strand(sub)
        # merge grp_id back onto sub
        sub = sub.join(clustered, how="left")
        out.append(sub)

    # 3) combine all targets & strands
    result = pd.concat(out).sort_index()
    # new label: target_subgroup
    result["overlap_group"] = (
        result["target name"]
        .astype(str)
        + "_"
        + result["grp_id"].astype(str)
        + "_"
        + result["strand"].astype(str)
    )
    return result

def calculate_hit_confidence_log(df, e_threshold=1e-5):
    df = df.copy()
    # 1) noise term in log-space (natural log)
    #    noise_weight = 2**(-log2(e_threshold)) noise_logw = -ln(e_threshold)
    noise_logw = -np.log(e_threshold)

    # 2) per-hit log-weight: ln(2**score) = score * ln(2)
    df['log_per_hit_weight'] = df['score'] * np.log(2)

    # 3) group log-sum of per-hit weights
    df['group_log_sum'] = df.groupby('overlap_group')['log_per_hit_weight'] \
                             .transform(lambda x: np.logaddexp.reduce(x.values))

    # 4) total log-weight = log(group_sum + noise_weight)
    df['total_log_weight'] = np.logaddexp(df['group_log_sum'], noise_logw)

    # 5) hit confidence = per_hit_weight / total_weight
    #    in log-space: exp(log_w − total_log_w)
    df['hit_conf'] = np.exp(df['log_per_hit_weight'] - df['total_log_weight'])

    # 6) debug: print any stragglers
    nan_rows = df[df['hit_conf'].isna()][[
      'score','log_per_hit_weight','group_log_sum','total_log_weight','hit_conf'
    ]]
    if not nan_rows.empty:
        print("Rows with NaN hit_conf:\n", nan_rows)

    # 7) pick the max-confidence row per overlap_group
    idx = (
      df
      .groupby('overlap_group')['hit_conf']
      .idxmax()
      .dropna()        # drop any NaN idx (should be none)
      .astype(int)
    )
    df_max_conf = df.loc[idx].reset_index(drop=True)
    return df_max_conf

def read_ko_occurence_txt(KO_OCCURRENCES_TXT):
  ko_occ = pd.read_csv(KO_OCCURRENCES_TXT, sep=r"\s+", names=['KO id','occurences'])
  idx = ko_occ[ko_occ['KO id'] == "KO_ID"].index
  ko_occ.drop(idx, inplace=True)
  ko_occ['KO_freq'] = ko_occ['occurences'] / 895

  return ko_occ

"""## Sigma Calculation (Completeness)"""

#sigma = 1 - ((np.exp(3 * 0.71) - 1) / np.exp(3))

#sigma

"""## Dk Calculation"""

def calculate_dk_per_ko(ko_occurences, bath_hits, sigma_val):
  df_dk = (bath_hits.merge(ko_occurences, on='KO id', how='left').fillna({'occurences':0,'KO_freq':1e-4}))
  sigma_val_1 = 1 - ((np.exp(3 * sigma_val) - 1) / np.exp(3))
  df_dk['sigma'] = sigma_val_1
  df_dk['Dk']  = (df_dk['hit_conf']+ (1 - df_dk['hit_conf']) * df_dk['sigma'] * df_dk['KO_freq'])
  return df_dk

"""## Neighbor Dk Calculation"""

def make_neighbor_dictionary(NEIGHBOR_TXT):
  neighbors = {}
  with open(NEIGHBOR_TXT) as f:
      for line in f:
          if not line.startswith("K"): continue
          ko, idx, nbrs_str = line.split(":", 2)
          ko = ko.strip()
          entries = [e.strip() for e in nbrs_str.split(",") if e.strip()]
          nbr_list = []

          for ent in entries:
              nbr_id, weight_str = ent.split(":")
              nbr_id = nbr_id.strip()
              weight_str = float(weight_str)
              if weight_str == 0.00:
                weight_str = 0.001
              nbr_list.append((nbr_id, weight_str))
          neighbors[ko] = nbr_list

  # Adjacency from neighbors
  adj = {ko: dict(nbrs) for ko, nbrs in neighbors.items()}

  return adj



def spring_update_probabilities(dk_dict, adjacency, alpha=0.6):
  new_dk = {}
  for i, p_i in dk_dict.items():
      #print(i,p_i)
      nbrs = adjacency.get(i, {})
      #print(len(nbrs))
      if not nbrs:
          new_dk[i] = p_i; continue
      sum_e = sum(nbrs.values())
      #print(sum_e)
      X     = alpha ** (1.0 / sum_e)
      #print(X)
      a_i   = 1.0 - p_i
      #print(nbrs)
      shift = sum(a_i * (w/sum_e)*X * dk_dict.get(j,0.0) for j,w in nbrs.items())
      #print(shift)
      #new_dk[i] = min(p_i + shift, 1.0)
      new_dk[i] = min(p_i + shift,1.0)

  df_spring = (pd.DataFrame.from_dict(new_dk, orient="index", columns=["Dk_Neighbors"])
          .reset_index()
          .rename(columns={"index": "KO id"}))
  return df_spring



"""## Modules"""

def module_kos():
  #Access all module info
  glob.glob(os.path.join(MODULE_JSON_DIR, "module_*_paths.json"))

  #Modules and the KOs it belongs to

  #Add to each KO in dataframe which modules it is a part of

def compute_path_probability(path, dk_map):
    p = np.float128(1.0)
    for node in path:
        if '_' in node:
            p *= np.float128(dk_map.get(node.split("_")[0], 1.0))
    return p

def score_path(path, dk_map, *, alpha=0.6):
    raw = compute_path_probability(path, dk_map)
    L   = sum(1 for n in path if 'K' in n)

    if raw > 0 and L>0:
        log_p      = float(np.log(raw))
        avg_log_p  = log_p / L
        geo        = exp(avg_log_p)
    else:
        log_p      = avg_log_p = -np.inf
        geo = 0.0

    return raw, geo


def find_most_probable_row(paths_dict, dk_map_before, dk_map_after):
    rows = []
    for pid, comma in paths_dict.items():
        path = [n.strip() for n in comma.split(",")]
        r_before, g_before = score_path(path, dk_map_before)
        r_after, g_after = score_path(path, dk_map_after)
        rows.append({
            'path_id':      int(pid),
            'path_str':     " -> ".join(path),
            'raw_before':   r_before,
            'geo_before':   g_before,
            'raw_after':    r_after,
            'geo_after':    g_after
        })

    if not rows:
        return None

    # Choose the row with highest geo_after
    best_row = max(rows, key=lambda x: x['geo_after'])
    return best_row

def path_probabilities(module_json_dir, dk_map_before, dk_map_after):
    best_rows = []
    pattern = os.path.join(module_json_dir, "module_*_paths.json")
    json_files = glob.glob(pattern)

    for json_file in json_files:
        # Extract module name from filename, e.g. 'module_M00001'
        module_name_1 = os.path.basename(json_file).split("_paths.json")[0]
        module_name = os.path.basename(module_name_1).split("module_")[-1]

        # Load the dictionary of paths for this module
        with open(json_file) as f:
            paths_dict = json.load(f)

        # Compute best path for this module
        best = find_most_probable_row(paths_dict, dk_map_before, dk_map_after)
        if best:
            best['module'] = module_name
            best_rows.append(best)

    # Turn the list of best‐path dicts into a DataFrame
    df_best = pd.DataFrame(best_rows)

    # Reorder columns for readability
    columns_order = [
        'module',
        'path_id',
        'path_str',
        'raw_before',
        'geo_before',
        'raw_after',
        'geo_after'
    ]
    df_best = df_best[columns_order]
    return df_best

def modules_to_kos():
  ko_to_modules = {}
  pattern = os.path.join(MODULE_JSON_DIR, "module_*_nodes.json")
  for filepath in glob.glob(pattern):
      # Extract a module name (e.g. “module_M00001”) from the filename
      filename = os.path.basename(filepath)
      module_name = filename.replace("_nodes.json", "")
      module_name = module_name.replace("module_", "")

      # Load that module’s node list
      with open(filepath, "r") as f:
          module_nodes = json.load(f)

      # For each node starting with "K", split off the KO part (before the first "_")
      module_kos = {n.split("_", 1)[0] for n in module_nodes if n.startswith("K")}

      # Now register each KO in ko_to_modules
      for ko in module_kos:
          # Create a new list if this is the first time we see `ko`
          if ko not in ko_to_modules:
              ko_to_modules[ko] = []
          # Append this module’s name (e.g. "module_M00001") to that KO’s list
          ko_to_modules[ko].append(module_name)

  ko_to_modules_str = {
      ko: ",".join(sorted(mods_list))
      for ko, mods_list in ko_to_modules.items()
  }

  return ko_to_modules_str
  
def export_module_data_with_best_path(
    module_json_dir: str,
    ko_occ_df: pd.DataFrame,
    dk_before: dict,
    evalue: dict,
    dk_after: dict,
    df_best_paths: pd.DataFrame,
    output_path: str
):
    
    ko_freq = ko_occ_df.set_index('KO id')['KO_freq'].to_dict()

    # Prepare best_path map, converting all numeric fields to float
    raw_map = df_best_paths.set_index('module')[
        ['path_id','path_str','raw_before','geo_before','raw_after','geo_after']
    ].to_dict(orient='index')

    best_path_map = {}
    for module_id, bp in raw_map.items():
        if bp is None:
            best_path_map[module_id] = None
        else:
            best_path_map[module_id] = {
                'path_id':     int(bp['path_id']),
                'path_str':    bp['path_str'],
                'raw_before':  float(bp['raw_before']),
                'geo_before':  float(bp['geo_before']),
                'raw_after':   float(bp['raw_after']),
                'geo_after':   float(bp['geo_after']),
            }

    aggregated = {}
    for node_file in glob.glob(os.path.join(module_json_dir, "module_*_nodes.json")):
        module_id = os.path.basename(node_file).split("_")[1]
        with open(node_file) as f:
            nodes_dict = json.load(f)

        nodes_list = []
        for node, group in nodes_dict.items():
            ko = node.split("_")[0]
            nodes_list.append({
                "id":             node,
                "group":          int(group),
                "KO_Occurrence":  float(ko_freq.get(ko, 0.0)),
                "Dk_before":      float(dk_before.get(ko, 0.0)),
                "E-value":        float(evalue.get(ko, 100.0)),
                "Dk_after":       float(dk_after.get(ko, 0.0)),
            })

        nodes_list.sort(key=lambda x: x["group"])
        aggregated[module_id] = {
            "nodes":     nodes_list,
            "best_path": best_path_map.get(module_id)
        }

    with open(output_path, "w") as f:
        json.dump(aggregated, f, indent=4)

    print(f"Wrote enriched modules + best‐path JSON to {output_path}")

def completeness_float(x):
    """Argparse type: float in [0.0,1.0]."""
    try:
        f = float(x)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{x!r} is not a valid float")
    if not 0.0 <= f <= 1.0:
        raise argparse.ArgumentTypeError(f"completeness must be between 0.0 and 1.0, got {f}")
    return f  

def existing_nonempty_tbl(path):
    # 1) check extension
    if not (path.endswith(".tbl") or path.endswith(".domtblout")):
        raise argparse.ArgumentTypeError(
            f"‘{path}’ must end in .tblout or .domtblout"
        )
    # 2) check file exists
    if not os.path.isfile(path):
        raise argparse.ArgumentTypeError(f"File not found: {path}")
    # 3) check non-empty
    if os.path.getsize(path) == 0:
        raise argparse.ArgumentTypeError(f"File is empty: {path}")
    return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Process BATH/HMMER output (tbl or domtblout)')
    #parser.add_argument('file', help='Path to the .tblout or .domtblout file')
    parser.add_argument('file',type=existing_nonempty_tbl,help='Path to the .tblout or .domtblout file (must exist, be non-empty, and have correct extension)')
    parser.add_argument('-f', '--format', choices=['tbl','domtblout'], required=True,
                        help='Specify which HMMER output format to parse')
    parser.add_argument('-c','--completeness', type=completeness_float,default=1.0,help='Completeness of sample obtained via CHECKM or BUSCO (0.0–1.0). Defaults to 1.0.')
    parser.add_argument('-o', '--output', required=True,
                        help='Output prefix or directory for CSV reports')
    args = parser.parse_args()

    sample = os.path.basename(args.file).split('.')[0]
    sigma = args.completeness
    if not (0.0 <= sigma <= 1.0):
        parser.error(f"--sigma must be between 0 and 1, but you passed {sigma}")
    print(f"Processing sample {sample} with sigma={sigma}")
    
    HERE = os.path.dirname(__file__)
    #"KEGG_Graphs_Generated"
    MODULE_JSON_DIR = os.path.join(HERE, "Graph_Dependencies", "KEGG_Graphs_Generated")
    ko_to_modules_str=modules_to_kos()
    #ko_occ = read_ko_occurence_txt('ko_occurences.txt')
    KO_OCC_TXT     = os.path.join(HERE, "Data_Dependencies", "ko_occurences.txt")
    #adj = make_neighbor_dictionary('ko_normalized_prediction.txt')
    KO_NEIGH_TXT   = os.path.join(HERE, "Data_Dependencies", "ko_normalized_prediction.txt")

    # Parse input
    if args.format == 'tbl':
        df_hits = process_tbl(args.file)
        df_grouped = assign_overlap_groups(df_hits)
        df_conf    = calculate_hit_confidence_log(df_grouped.reset_index(), e_threshold=1e-5)
        df_conf    = df_conf.sort_values('score', ascending=False).drop_duplicates(subset='KO id')
        # Merge with all KOs
        ko_modules = modules_to_kos()
        all_kos = sorted(ko_modules.keys())
        df_master = pd.DataFrame({'KO id': all_kos})
        df_all = df_master.merge(df_conf, on='KO id', how='left').fillna({'score':0,'E-value':100.0,'hmm from':0,'hmm to':0,'ali from':0,'ali to':0})

        # Dk calculation
        df_dk  = calculate_dk_per_ko(ko_occ, df_all, sigma)
        dk_dict = dict(zip(df_dk['KO id'], df_dk['Dk']))
        # Neighbor diffusion
        df_spring = spring_update_probabilities(dk_dict, adj, alpha=0.6)
        df_dk_new = df_dk.merge(df_spring, on='KO id', how='left').fillna({'Dk_Neighbors':0.0})
        df_dk_new['Modules'] = df_dk_new['KO id'].map(ko_modules)

        # Path scoring
        new_dk = df_dk_new.set_index('KO id')['Dk_Neighbors'].to_dict()
        df_paths = path_probabilities('KEGG_Graphs_Generated', dk_dict, new_dk)

        # Write outputs
        out_pref = args.output
        out_dir = os.path.dirname(out_pref) or "."
        os.makedirs(out_dir, exist_ok=True)
        df_dk_new.to_csv(f"{out_pref}_dk.csv", index=False)
        df_paths.to_csv(f"{out_pref}_paths.csv", index=False)
        print(f"Reports written to {out_pref}_dk.csv and {out_pref}_paths.csv")
        
        export_module_data_with_best_path(
            module_json_dir=MODULE_JSON_DIR,
            ko_occ_df=ko_occ,
            dk_before=dk_dict,
            evalue=dict(zip(df_dk['KO id'], df_dk['E-value'].replace(np.nan,100.0))),
            dk_after=new_dk,
            df_best_paths=df_paths,
            output_path=f"{out_pref}_modules_enriched.json"
        )
        print(f"Diagram reports written to {out_pref}_nodes_enriched.csv")
        print(f"Open HTML file index.html in a local browser. Upload {out_pref}_nodes_enriched.json when prompted.")
    else:
        hmm_hits = process_domtblout(args.file)
        hmm_groups = assign_overlap_groups(hmm_hits)
        hmm_groups = hmm_groups.drop(columns=["grp_id"])
        hmm_hits_1 = calculate_hit_confidence_log(hmm_groups.reset_index(), e_threshold=1e-5)
        print("Number of rows after hit confidence calculation: ",len(hmm_hits_1))
        hmm_hits_1 = hmm_hits_1.sort_values('score', ascending=False)
        hmm_hits_1 = hmm_hits_1.drop_duplicates(subset='KO id', keep='first')
        print("Number of rows after duplicates dropped: ",len(hmm_hits_1))
        all_kos_hmm = sorted(ko_to_modules_str.keys())
        df_master_hmm = pd.DataFrame({'KO id': all_kos_hmm})

        hmm_hits_all_kos = (df_master_hmm.merge(hmm_hits_1, on='KO id', how='left'))
        hmm_hits_all_kos['hit_conf'] = hmm_hits_all_kos['hit_conf'].fillna(0)
        print("Number of rows after adding all available KO information: ",len(hmm_hits_all_kos))

        hmm_df_dk = calculate_dk_per_ko(ko_occ, hmm_hits_all_kos, sigma)
        hmm_dk_dict = dict(zip(hmm_df_dk['KO id'], hmm_df_dk['Dk']))
        hmm_dk_spring_all = spring_update_probabilities(hmm_dk_dict, adj, alpha=0.6)
        hmm_df_dk_new = hmm_df_dk.merge(hmm_dk_spring_all, on="KO id", how="left")

        hmm_df_dk_new["Modules"] = hmm_df_dk_new["KO id"].map(ko_to_modules_str)
        hmm_df_dk_new = hmm_df_dk_new.dropna(subset=['Modules'])

        series = hmm_df_dk_new.set_index("KO id")["Dk_Neighbors"]
        new_dk_dict = series.to_dict()

        hmm_paths = path_probabilities(MODULE_JSON_DIR, hmm_dk_dict, new_dk_dict)

        out_pref = args.output
        out_dir = os.path.dirname(out_pref) or "."
        os.makedirs(out_dir, exist_ok=True)
        hmm_df_dk_new.to_csv(f"{out_pref}_dk.csv", index=False)
        hmm_paths.to_csv(f"{out_pref}_paths.csv", index=False)
        print(f"Reports written to {out_pref}_dk.csv and {out_pref}_paths.csv")
        export_module_data_with_best_path(
        module_json_dir=MODULE_JSON_DIR,
        ko_occ_df=ko_occ,
        dk_before=hmm_dk_dict,
        evalue=dict(zip(hmm_hits_all_kos['KO id'], hmm_hits_all_kos['E-value'].replace(np.nan,100.0))),
        dk_after=new_dk_dict,
        df_best_paths=hmm_paths,
        output_path=f"{out_pref}_sample_modules_representation.json"
        )
            
        print(f"Diagram reports written to {out_pref}_nodes_enriched.csv")
        print(f"Open HTML file index.html in a local browser. Upload {out_pref}_nodes_enriched.json when prompted.")
