/* global BUILDCONFIG */
import angular from 'angular';
import {Map} from 'immutable';
import ProjectActions from '_redux/actions/project-actions';
import AnnotationActions from '_redux/actions/annotation-actions';
import _ from 'lodash';

class ProjectsEditController {
    constructor( // eslint-disable-line max-params
        $log, $q, $state, $scope, modalService, $timeout, $ngRedux, $location,
        authService, projectService, projectEditService,
        mapService, mapUtilsService, layerService,
        datasourceService, imageOverlayService, thumbnailService, sceneService,
        platform, paginationService
    ) {
        'ngInject';
        $scope.autoInject(this, arguments);
    }

    $onInit() {
        let unsubscribe = this.$ngRedux.connect(
            () => ({}),
            Object.assign({}, ProjectActions, AnnotationActions)
        )(this);
        this.$scope.$on('$destroy', unsubscribe);

        this.getMap().then(map => this.setProjectMap(map));
        this.mosaicLayer = new Map();
        this.sceneLayers = new Map();
        this.projectId = this.$state.params.projectid;
        this.initialCenter = BUILDCONFIG.MAP_CENTER || [0, 0];
        this.initialZoom = BUILDCONFIG.MAP_ZOOM || 2;

        if (!this.project) {
            if (this.projectId) {
                this.loadingProject = true;
                this.projectUpdateListeners = [];
                this.projectEditService.setCurrentProject(this.projectId, true).then(
                    (project) => {
                        this.project = project;
                        if (!this.$location.search().bbox) {
                            this.fitProjectExtent();
                        }
                        this.loadingProject = false;
                        this.projectUpdateListeners.forEach((wait) => {
                            wait.resolve(project);
                        });
                        this.initColorComposites();
                        this.layerFromProject();
                        if (!this.authService.user) {
                            this.permissions = [];
                        } else {
                            this.projectService
                                .getProjectPermissions(this.project, this.authService.user)
                                .then(permissions => {
                                    this.permissions = permissions;
                                });
                        }
                    },
                    () => {
                        this.loadingProject = false;
                    }
                );
            } else {
                this.$state.go('projects.list');
            }
        }
        this.resetAnnotations();
        if (this.projectId) {
            this.setProjectId(this.projectId);
            this.setPermissionsTab();
        }
    }

    $postLink() {
        if (this.project) {
            if (!this.$location.search().bbox) {
                this.fitProjectExtent();
            }
        }
    }

    getMap() {
        return this.mapService.getMap('edit');
    }

    setPermissionsTab() {
        this.projectService.fetchProject(this.projectId).then(thisProject => {
            this.projectOwnerId = thisProject.owner.id || thisProject.owner;
            this.actingUserId = this.authService.user.id;
        });
    }

    waitForProject() {
        return this.$q((resolve, reject) => {
            this.projectUpdateListeners.push({resolve, reject});
        });
    }

    fitProjectExtent() {
        this.getMap().then(m => {
            this.mapUtilsService.fitMapToProject(m, this.project);
        });
    }

    addUningestedScenesToMap(scenes) {
        this.getMap().then((mapWrapper) => {
            mapWrapper.deleteLayers('Uningested Scenes');
            scenes.filter((scene) => {
                return scene.tileFootprint && scene.thumbnails && scene.thumbnails.length;
            }).forEach((scene) => {
                let thumbUrl = this.thumbnailService.getBestFitUrl(scene.thumbnails, 1000);
                let boundsGeoJson = L.geoJSON();
                boundsGeoJson.addData(scene.tileFootprint);
                let imageBounds = boundsGeoJson.getBounds();

                this.sceneService.datasource(scene).then(d => {
                    let overlay = this.imageOverlayService.createNewImageOverlay(
                        thumbUrl,
                        imageBounds, {
                            opacity: 1,
                            dataMask: scene.dataFootprint,
                            thumbnail: thumbUrl,
                            attribution: `©${d.name} `
                        }
                    );
                    mapWrapper.addLayer(
                        'Uningested Scenes',
                        overlay,
                        {
                            showLayer: false
                        }
                    );
                });
            });
        });
    }

    layerFromProject() {
        let url = this.projectService.getProjectTileURL(
            this.project,
            {token: this.authService.token()}
        );
        let layer = L.tileLayer(url, {
            maxZoom: 30
        });

        this.getMap().then(m => {
            m.setLayer('Ingested Scenes', layer, true);
        });
        this.mosaicLayer = this.mosaicLayer.set(this.projectId, layer);
    }

    setHoveredScene(scene) {
        if (!scene) {
            return;
        }
        let styledGeojson = Object.assign({}, scene.dataFootprint, {
            properties: {
                options: {
                    weight: 2,
                    fillOpacity: 0
                }
            }
        });
        this.getMap().then((map) => {
            map.setGeojson('footprint', styledGeojson, {rectify: true});
        });
    }

    removeHoveredScene() {
        this.getMap().then((map) => {
            map.deleteGeojson('footprint');
        });
    }

    initColorComposites() {
        return this.fetchUnifiedComposites(true).then(
            composites => {
                this.unifiedComposites = composites;
            }
        );
    }

    fetchDatasources(force = false) {
        if (!this.datasourceRequest || force) {
            this.datasourceRequest = this.projectService.getProjectDatasources(this.projectId)
                .then((datasources) => {
                    this.bands = this.datasourceService.getUnifiedBands(datasources);
                    return datasources;
                });
        }
        return this.datasourceRequest;
    }

    fetchUnifiedComposites(force = false) {
        if (!this.unifiedCompositeRequest || force) {
            this.unifiedCompositeRequest = this.fetchDatasources(force).then(datasources => {
                return this.datasourceService.getUnifiedColorComposites(datasources);
            });
        }
        return this.unifiedCompositeRequest;
    }

    publishModal() {
        this.modalService.open({
            component: 'rfProjectPublishModal',
            resolve: {
                project: () => this.project,
                tileUrl: () => this.projectService.getProjectTileURL(this.project),
                shareUrl: () => this.projectService.getProjectShareURL(this.project)
            }
        }).result.catch(() => {});
    }

    openShareModal() {
        this.modalService.open({
            component: 'rfPermissionModal',
            resolve: {
                object: () => this.project,
                permissionsBase: () => 'projects',
                objectType: () => 'PROJECT',
                objectName: () => this.project.name,
                platform: () => this.platform
            }
        }).result.catch(() => {});
    }

    openExportModal() {
        this.getMap().then(m => {
            return m.map.getZoom();
        }).then(zoom => {
            this.modalService.open({
                component: 'rfProjectExportModal',
                resolve: {
                    project: () => this.project,
                    zoom: () => zoom
                }
            });
        }).result.catch(() => {});
    }

}

const ProjectsEditModule = angular.module('pages.projects.edit', []);

ProjectsEditModule.controller('ProjectsEditController', ProjectsEditController);

export default ProjectsEditModule;
