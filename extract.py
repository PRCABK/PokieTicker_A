import gzip
import shutil
import tarfile
import os

print("Extracting pokieticker.db...")
if not os.path.exists('pokieticker.db'):
    with gzip.open('pokieticker.db.gz', 'rb') as f_in:
        with open('pokieticker.db', 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
print("Extracted pokieticker.db.")

print("Extracting models.tar.gz...")
os.makedirs('backend/ml', exist_ok=True)
with tarfile.open('models.tar.gz', 'r:gz') as tar:
    tar.extractall(path='backend/ml/')
print("Extracted models.")
