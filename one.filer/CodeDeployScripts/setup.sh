# Update the source
ARCHIVE=one.filer-dev.tar.gz
cd /home/ubuntu
aws s3 cp s3://refinio-artefacts/$ARCHIVE ./
tar -xzf $ARCHIVE
