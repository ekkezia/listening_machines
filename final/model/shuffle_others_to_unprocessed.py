import os
import random
import shutil

others_dir = os.path.join(os.path.dirname(__file__), 'model', 'others')
unprocessed_dir = os.path.join(os.path.dirname(__file__), 'unprocessed', 'others')

os.makedirs(unprocessed_dir, exist_ok=True)

for folder_name in os.listdir(others_dir):
    folder_path = os.path.join(others_dir, folder_name)
    if os.path.isdir(folder_path):
        items = [f for f in os.listdir(folder_path) if os.path.isfile(os.path.join(folder_path, f))]
        selected = random.sample(items, min(10, len(items)))
        for item in selected:
            src = os.path.join(folder_path, item)
            dst = os.path.join(unprocessed_dir, f'{folder_name}_{item}')
            shutil.copy2(src, dst)
print('Done!')
