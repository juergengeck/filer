# Update the source
ARCHIVE=one.core-doc-$DEPLOYMENT_GROUP_NAME.tar.gz
DIR=one.core.doc.$DEPLOYMENT_GROUP_NAME
cd /home/ubuntu
aws s3 cp s3://refinio-artefacts/$ARCHIVE ./
tar -xzf $ARCHIVE --one-top-level=$DIR --strip-components=1
