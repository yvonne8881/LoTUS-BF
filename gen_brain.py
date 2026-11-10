import numpy as np
import nilearn.datasets as datasets
import nilearn.surface as surface
import trimesh

fsaverage = datasets.fetch_surf_fsaverage('fsaverage5')

coords_l, faces_l = surface.load_surf_mesh(fsaverage.pial_left)
coords_r, faces_r = surface.load_surf_mesh(fsaverage.pial_right)

faces_r_offset = faces_r + len(coords_l)
vertices = np.vstack([coords_l, coords_r])
faces = np.vstack([faces_l, faces_r_offset])

mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
mesh.export('brain.glb')

print("✅ brain.glb")
