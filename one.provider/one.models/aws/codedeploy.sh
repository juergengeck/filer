# Update the source
ARCHIVE=one.models-doc-$DEPLOYMENT_GROUP_NAME.tar.gz
DIR=one.models.doc.$DEPLOYMENT_GROUP_NAME
cd /home/ubuntu
aws s3 cp s3://refinio-artefacts/$ARCHIVE ./
mkdir -p $DIR && tar -xzf $ARCHIVE -C $DIR
