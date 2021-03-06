const uuid = require("uuid/v4");
const mongoCollections = require("../config/mongoCollections");
const del = require("del");

const students = mongoCollections.students;
const teachers = mongoCollections.teachers;
const courses = mongoCollections.courses;
const assignments = mongoCollections.assignments;

function addCourseToTeacher(teacherId, courseId) {
	if (typeof teacherId != "string") {
		return Promise.reject("StudentId must be a string");
	}
	if (typeof courseId != "string") {
		return Promise.reject("ClassId must be a string");
	}

	let courseInfo = {
		courseId: courseId,
		isCurrentlyTeaching: true
	};

	return teachers().then((collection) => {
		return collection.update({_id: teacherId}, {$addToSet: {courses: courseInfo}}).then(() => {
			return courseId;
		});
	});
}

function addCourse(courseName, teacherId) {
	if (typeof courseName != "string") {
		return Promise.reject("Course Name must be provided");
	}
	
	let newCourse = {
		_id: uuid(),
		courseName: courseName,
		teacherId: teacherId,
		studentIDs: [],
		assignments: [],
		announcements: []
	}

	return courses().then((collection) => {
		return collection.insertOne(newCourse).then((information) => {
			return information.insertedId;
		});
	});
}

// User: Teacher
function addStudentsToCourse(studentIds, courseId) {
	if (typeof studentIds != "object" && studentIds.length > 0) {
		return Promise.reject("StudentIds must be a non-empty array");
	}
	if (typeof courseId != "string") {
		return Promise.reject("CourseId must be a string");
	}

	return courses().then((collection) => {
		return collection.update({_id: courseId}, {$addToSet: {studentIDs: {$each: studentIds}}}).then(() => {
			let courseInfo = {
				courseId: courseId,
				grade: NaN,
				isCurrentlyTaking: true
			}

			return students().then((collection) => {
				return collection.update({_id: {$in: studentIds}}, {$addToSet: {courses: courseInfo}}, {multi: true});
			});
		});
	});
}

function addAssignment(assignmentName, prompt, dueDate) {
	if (typeof assignmentName != "string") {
		return Promise.reject("Assignment name must be provided");
	}
	if (typeof prompt != "string") {
		return Promise.reject("Prompt must be provided");
	}
	if (typeof dueDate != "string") {
		return Promise.reject("Due date must be provided");
	}

	let newAssignment = {
		_id: uuid(),
		assignmentName: assignmentName,
		prompt: prompt,
		dueDate: dueDate,
		submissions: []
	};

	return assignments().then((collection) => {
		return collection.insertOne(newAssignment);
	});
}

function addAssignmentToCourse(courseId, assignmentId) {
	if (typeof courseId != "string") {
		return Promise.reject("Course id must be given");
	}
	if (typeof assignmentId != "string") {
		return Promise.reject("Assignment id must be given")
	}
	
	return courses().then((collection) => {
		return collection.findOneAndUpdate({_id: courseId}, {$addToSet: {assignments: assignmentId}}).then((course) => {
			return assignments().then((assCollection) => {
				let newSubmissions = [];
				course.value.studentIDs.forEach((studentId) => {
					newSubmissions.push({
						studentId: studentId,
						grade: NaN,
						submissionDate: undefined,
						submission: undefined,
						teacherResponse: undefined
					});
				});
				return assCollection.update({_id: assignmentId}, {$addToSet: {submissions: {$each: newSubmissions}}}).then(() => {
					return assignmentId;
				});
			});
		});
	});
}

function updateCourseGrade(studentId, courseId, grade) {
	return students().then((collection) => {
		return collection.update({_id: studentId, courses: {$elemMatch: {courseId: courseId}}},
								 {$set: {"courses.$.grade": grade}});
	});
}

function calculateAndUpdateCourseGrade(studentId, courseId) {
	return getCourse(courseId).then((course) => {
		let grade = 0;
		let graded_assignments = 0;
		return module.exports.getAssignmentsForCourse(courseId).then((assignments) => {
			assignments.forEach((assignment) => {
				assignment.submissions.forEach((submission) => {
					if ((submission.studentId === studentId) && !isNaN(grade)) {
						grade += submission.grade;
						graded_assignments++;
					}
				});
			});
			grade /= graded_assignments;
			return updateCourseGrade(studentId, courseId, grade);
		});
	});
}

function getStudent(studentId) {
	return students().then((collection) => {
		return collection.findOne({ _id: studentId }).then((student) => {
			if (!student) throw "student not found";
			return student;
		})
	});
}

function getTeacher(teacherId) {
	return teachers().then((collection) => {
		return collection.findOne({ _id: teacherId }).then((teacher) => {
			if (!teacher) throw "teacher not found";
			return teacher;
		})
	});
}

function getCourse(courseId) {
	return courses().then((collection) => {
		return collection.findOne({_id: courseId}).then((course) => {
			if (!course) throw "course not found";
			return course;
		});
	});
}

function getAssignment(assignmentId) {
	return assignments().then((collection) => {
		return collection.findOne({_id: assignmentId}).then((assignment) => {
			return assignment;
		});
	});
}

function deleteCourseForTeacher(courseId, teacherId) {
	return teachers().then((collection) => {
		let courseInfo = {
			courseId: courseId
		};
		return collection.update({_id: teacherId}, {$pull: {courses: courseInfo}})
	});
}

function deleteCourseForStudents(courseId, studentIds) {
	return students().then((collection) => {
		let courseInfo = {
			courseId: courseId
		};
		return collection.update({_id: {$in: studentIds}}, {$pull: {courses: courseInfo}}, {multi: true});
	});
}

function deleteAssignments(assignmentIds) {
	return assignments().then((collection) => {
		return collection.find({_id: {$in: assignmentIds}}).toArray().then((assigns) => {
			let files = [];
			assigns.forEach((x) => {
				x.submissions.forEach((y) => {
					if (y.submission)
					files.push("file_uploads/" + y.submission.filename);
				});
			});
			return del(files).then(() => {
				return collection.remove({_id: {$in: assignmentIds}});
			});
		});
	})
}

module.exports = {
	// User: Passport
	failedLoginAttempt(username, failedAttempts) {
		let waitTime = Math.pow(2.5, failedAttempts);
		let updates = {
			$inc: {failedLoginAttempts: 1},
			$set: {lockAccountUntil: Date.now() + waitTime}
		};
		
		return students().then((collection) => {
			return collection.findOneAndUpdate({username: username}, updates).then((result) => {
				if (result.value) {
					return;
				}
				return teachers().then((collection) => {
					return collection.findOneAndUpdate({username: username}, updates).then((result) => {
						return;
					});
				});
			});
		});
	},
	// User: Passport
	accountLocked(username) {
		let lockData = {};
		return students().then((collection) => {
			return collection.findOne({username: username}).then((student) => {
				if (student) {
					lockData.failedLoginAttempts = student.failedLoginAttempts,
					lockData.lockAccountUntil = student.lockAccountUntil
					lockData.locked = Date.now() < student.lockAccountUntil;
					return lockData;
				}
				return teachers().then((collection) => {
					return collection.findOne({username: username}).then((teacher) => {
						if (teacher) {
							lockData.failedLoginAttempts = teacher.failedLoginAttempts,
							lockData.lockAccountUntil = teacher.lockAccountUntil
							lockData.locked = Date.now() < teacher.lockAccountUntil;
							return lockData;
						}
						return {locked: false, failedLoginAttempts: undefined, lockAccountUntil: undefined};
					});
				});
			});
		});
	},
	// User: Passport
	resetLoginAttempts(userId, isStudent) {
		let updates = {
			$set: {failedLoginAttempts: 0}
		};
		
		if (isStudent) {
			return students().then((collection) => {
				return collection.update({_id: userId}, updates);
			});
		}
		return teachers().then((collection) => {
			return collection.update({_id: userId}, updates);
		});
	},
	// User: Student
	addStudent(studentId, firstName, lastName, username, hashedPassword) {
		if (typeof studentId != "string") {
			return Promise.reject("Student ID must be provided");
		}
		if (typeof firstName != "string") {
			return Promise.reject("First name must be provided");
		}
		if (typeof lastName != "string") {
			return Promise.reject("Last name must be provided");
		}
		if (typeof username != "string") {
			return Promise.reject("Username must be provided");
		}
		if (typeof hashedPassword != "string") {
			return Promise.reject("Hashed password must be provided");
		}

		let newStudent = {
			_id: studentId,
			firstName: firstName,
			lastName: lastName,
			username: username,
			hashedPassword: hashedPassword,
			failedLoginAttempts: 0,
			lockAccountUntil: Date.now(),
			courses: []
		};

		return students().then((collection) => {
			return collection.insertOne(newStudent);
		});
	},
	// User: Teacher
	addTeacher(teacherId, firstName, lastName, username, hashedPassword) {
		if (typeof teacherId != "string") {
			return Promise.reject("Student ID must be provided");
		}
		if (typeof firstName != "string") {
			return Promise.reject("First name must be provided");
		}
		if (typeof lastName != "string") {
			return Promise.reject("Last name must be provided");
		}
		if (typeof username != "string") {
			return Promise.reject("Username must be provided");
		}
		if (typeof hashedPassword != "string") {
			return Promise.reject("Hashed password must be provided");
		}

		let newTeacher = {
			_id: teacherId,
			firstName: firstName,
			lastName: lastName,
			username: username,
			hashedPassword: hashedPassword,
			failedLoginAttempts: 0,
			lockAccountUntil: Date.now(),
			courses: []
		};

		return teachers().then((collection) => {
			return collection.insertOne(newTeacher);
		});
	},
	// User: Teacher
	createCourseForTeacher(teacherId, courseName, students) {
		return addCourse(courseName, teacherId).then((courseId) => {
			return addStudentsToCourse(students, courseId).then(() => {
				return addCourseToTeacher(teacherId, courseId);
			});
		});
	},
	// User: Teacher
	createAssignmentForCourse(courseId, assignmentName, prompt, dueDate) {
		return addAssignment(assignmentName, prompt, dueDate).then((assignment) => {
			return addAssignmentToCourse(courseId, assignment.insertedId);
		});
	},
	// User: Teacher
	createAnnouncementForCourse(courseId, name, description) {
		return courses().then((collection) => {
			let newAnnouncement = {
				name: name,
				description: description,
				date: new Date()
			};
			return collection.update({_id: courseId}, {$addToSet: {announcements: newAnnouncement}});
		});
	},
	// User: Teacher || Student
	getAssignmentsForCourse(courseId) {
		return courses().then((collection) => {
			return collection.findOne({_id: courseId}).then((course) => {
				return assignments().then((collection) => {
					return collection.find({_id: {$in: course.assignments}}).toArray().then((assignments) => assignments);
				});
			});
		});
	},
	// User: Teacher
	updateAssignmentInfo(assignmentId, newInfo) {
		return assignments().then((collection) => {
			return collection.update({_id: assigmentId, newInfo});
		});
	},
	// User: Teacher
	updateAssignmentGrade(studentId, courseId, assignmentId, grade, teacherResponse) {
		if (!grade && !teacherResponse) {
			return Promise.reject("Must provide a grade or comment");
		}
		return assignments().then((collection) => {
			if (!grade)
				return collection.update({_id: assignmentId, submissions: {$elemMatch: {studentId: studentId}}},
										 {$set: {"submissions.$.teacherResponse": teacherResponse}});
			if (!teacherResponse)
				return collection.update({_id: assignmentId, submissions: {$elemMatch: {studentId: studentId}}},
										 {$set: {"submissions.$.grade": grade}});
			return collection.update({_id: assignmentId, submissions: {$elemMatch: {studentId: studentId}}},
									 {$set: {"submissions.$.grade": grade,
											 "submissions.$.teacherResponse": teacherResponse}}).then(() => {
												 return calculateAndUpdateCourseGrade(studentId, courseId);
											 });
		});
	},
	// User: Student
	updateAssignmentSubmission(studentId, assignmentId, submission) {
		return assignments().then((collection) => {
			return collection.update({_id: assignmentId, submissions: {$elemMatch: {studentId: studentId}}},
									 {$set: {"submissions.$.submission": submission,
											 "submissions.$.submissionDate": new Date()}});
		});
	},
	// User: Teacher || Student
	getAssignmentSubmission(assignmentId, studentId) {
		return assignments().then((collection) => {
			return collection.findOne({_id: assignmentId}, {submissions: {$elemMatch: {studentId: studentId}}}).then((assignment) => {
				return assignment.submissions[0].submission;
			});
		});
	},
	// User : Student 
	getCoursesForStudent(studentId) {
		return getStudent(studentId).then((student) => {
			let coursesIds = student.courses.map((x) => {return x.courseId});
			if (coursesIds.length === 0) return [];
			return courses().then((collection) => {
				return collection.find({_id: {$in: coursesIds}}, {courseName: 1}).toArray().then((courses_unordered) => {
					let courses = coursesIds.map((x) => {
						return courses_unordered.find((y) => y._id === x);
					});
					if (courses.length != student.courses.length) throw ("courses missing");
					let result = [];
					for (let x = 0; x < courses.length; x++) {
						result.push({index: x, name: courses[x].courseName, grade: student.courses[x].grade, isCurrentlyTaking: student.courses[x].isCurrentlyTaking});
					}
					return result;
				});
			});
		});
	},
	// User : Teacher
	getCoursesForTeacher(teacherId) {
		return getTeacher(teacherId).then((teacher) => {
			let coursesIds = teacher.courses.map((x) => {return x.courseId});
			return courses().then((collection) => {
				return collection.find({_id: {$in: coursesIds}}, {courseName: 1}).toArray().then((courses_unordered) => {
					let courses = coursesIds.map((x) => {
						return courses_unordered.find((y) => y._id === x);
					});
					if (courses.length != teacher.courses.length) throw ("courses missing");
					let result = [];
					for (let x = 0; x < courses.length; x++) {
						result.push({index: x, name: courses[x].courseName, isCurrentlyTeaching: teacher.courses[x].isCurrentlyTeaching});
					}
					return result;
				});
			});
		});
	},
	//User : Teacher || Student
	getCourse: getCourse,
	//User: Teacher
	getStudents(studentIds) {
		return students().then((collection) => {
			return collection.find({_id: {$in: studentIds}}).toArray().then((students) => {
				return students;
			})
		});
	},
	//User: Student || Teacher
	checkAuth(id, username) {
		return students().then((collection)=> {
			return collection.find({$or: [{_id: id}, {username: username}]}).toArray().then((results)=> {
				if (results.length) {
					throw "user already exists";
				} else {
					return teachers().then((collection) => {
						return collection.find({$or: [{_id: id}, {username: username}]}).toArray().then((results)=> {
							if (results.length)
								throw "user already exists";

							return true;
						});
					});
				}
			});
		});
	},
	//User: Student || Teacher
	getAuthByUsername(username) {
		return students().then((collection)=> {
			return collection.findOne({username: username}).then((user)=> {
				if (user) {
					user.isStudent = true;
					return user;
				} else {
					return teachers().then((collection) => {
						return collection.findOne({username: username}).then((user)=> {
							if (user)
								user.isTeacher = true;
							return user;
						});
					});
				}
			});
		});
	},
	getAuthByID(id) {
		return students().then((collection)=> {
			return collection.findOne({_id: id}).then((user)=> {
				if (user) {
					user.isStudent = true;
					return user;
				} else {
					return teachers().then((collection) => {
						return collection.findOne({_id: id}).then((user)=> {
							if (user)
								user.isTeacher = true;
							return user;
						});
					});
				}
			});
		});
	},
	deleteCourse(courseID) {
		return courses().then((collection) => {
			return collection.findOne({_id: courseID}).then((course) => {
				return deleteCourseForTeacher(course._id,course.teacherId).then(() => {
					return deleteCourseForStudents(course._id,course.studentIDs).then(() => {
						return deleteAssignments(course.assignments).then(() => {
							return collection.removeOne({_id: courseID});
						});
					});
				});
			})
		});
	}
}
